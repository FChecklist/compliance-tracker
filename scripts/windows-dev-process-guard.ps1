# windows-dev-process-guard.ps1
#
# RCA (2026-09-12, PM session): `next dev` (Turbopack) forks a REAL child
# process for its background type-checking overlay -- not an in-process
# check. Next's own source confirms this exactly:
#   node_modules/next/dist/esm/lib/typescript/runTypeScriptCli.js
#     spawn(process.execPath, [tscPath, ...args], { ... })
# which on this machine shows up as:
#   node "<repo>\node_modules\typescript\bin\tsc" --noEmit -p tsconfig.json
# measured resident at 1.2-2.3 GB on this codebase's size (11,500+ line
# schema.ts, hundreds of routes) -- confirmed twice live during a RAM
# investigation (kt/ or pm/ notes, 2026-09-12).
#
# Next.js knows this child is fragile to clean up and says so in its own
# comment on that same file: "The native compiler ignores SIGTERM and
# SIGINT, so send a kill signal. Target the whole process group..." -- and
# on Windows it does that via `taskkill /pid <pid> /T /F`. But that cleanup
# path ONLY runs if the PARENT `next dev` process itself gets a graceful
# exit/SIGINT/SIGTERM/SIGHUP. A hard, single-PID kill of the parent (e.g.
# `Stop-Process -Id <parentPid>` or `taskkill /PID <parentPid> /F` without
# `/T`) bypasses Node's own event loop entirely -- the parent dies, its
# cleanup handler never runs, and the tsc child is ORPHANED: still running,
# still holding 1-2+ GB, with nothing left to kill it. This is exactly what
# happened twice in one session after dev-mode servers were stopped via a
# tool that (as far as could be observed) does not appear to tree-kill.
#
# THE PERMANENT FIX HAS TWO HALVES:
#   1. Stop causing new orphans: always stop a Next dev server by killing
#      its WHOLE PROCESS TREE (-StopPort below), never just the top PID.
#   2. Clean up any orphan that already exists, safely: -Cleanup below only
#      ever touches a tsc process whose ORIGINAL PARENT PID is provably
#      gone -- it will never touch a tsc run that's still supervised by a
#      live parent, so it is safe to run at any time, including while other
#      legitimate dev/typecheck work is active.
#
# Usage:
#   powershell -File scripts/windows-dev-process-guard.ps1 -Cleanup
#   powershell -File scripts/windows-dev-process-guard.ps1 -StopPort 3000
#   powershell -File scripts/windows-dev-process-guard.ps1 -Cleanup -StopPort 3100

param(
    [switch]$Cleanup,
    [int]$StopPort,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $PSScriptRoot "..\windows-dev-process-guard.log"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Stop-ProcessTree($ProcId, $Reason) {
    if ($WhatIf) {
        Write-Log "[WHATIF] would taskkill /PID $ProcId /T /F ($Reason)"
        return
    }
    & taskkill /PID $ProcId /T /F 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Log "killed PID $ProcId and its tree ($Reason)"
    } else {
        Write-Log "taskkill on PID $ProcId exited $LASTEXITCODE (may have already exited) ($Reason)"
    }
}

# ---- -Cleanup: sweep orphaned Next.js background-typecheck processes ----
if ($Cleanup) {
    Write-Log "=== cleanup sweep starting ==="
    $freedEstimateMb = 0
    $killedCount = 0

    $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match [regex]::Escape("typescript") -and $_.CommandLine -match "--noEmit" }

    foreach ($proc in $candidates) {
        $parentAlive = $false
        if ($proc.ParentProcessId) {
            $parentAlive = [bool](Get-Process -Id $proc.ParentProcessId -ErrorAction SilentlyContinue)
        }

        if ($parentAlive) {
            Write-Log "SKIP PID $($proc.ProcessId): parent PID $($proc.ParentProcessId) is still alive -- looks like a real, currently-supervised typecheck run, not an orphan."
            continue
        }

        $liveProc = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
        $mb = if ($liveProc) { [math]::Round($liveProc.WorkingSet64 / 1MB, 1) } else { 0 }
        Write-Log "ORPHAN FOUND: PID $($proc.ProcessId), ${mb}MB, parent PID $($proc.ParentProcessId) no longer exists. CommandLine: $($proc.CommandLine)"
        Stop-ProcessTree -ProcId $proc.ProcessId -Reason "orphaned tsc --noEmit background type-checker"
        $freedEstimateMb += $mb
        $killedCount++
    }

    if ($killedCount -eq 0) {
        Write-Log "no orphaned typecheck processes found."
    } else {
        Write-Log "swept $killedCount orphan(s), approx ${freedEstimateMb}MB reclaimed."
    }
    Write-Log "=== cleanup sweep complete ==="
}

# ---- -StopPort: correctly tree-kill whatever owns a dev-server port ----
if ($StopPort) {
    Write-Log "=== stopping whatever owns port $StopPort (tree-kill, prevents new orphans) ==="
    $conns = Get-NetTCPConnection -LocalPort $StopPort -ErrorAction SilentlyContinue
    if (-not $conns) {
        Write-Log "port $StopPort is already free -- nothing to stop."
    } else {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
            $name = if ($proc) { $proc.ProcessName } else { "(already exited)" }
            Write-Log "port $StopPort owned by PID $procId ($name) -- tree-killing so any forked type-checker dies with it"
            Stop-ProcessTree -ProcId $procId -Reason "dev server on port $StopPort"
        }
    }
    Write-Log "=== stop complete ==="
}

if (-not $Cleanup -and -not $StopPort) {
    Write-Host "Usage: -Cleanup (sweep orphaned typecheck processes) and/or -StopPort <port> (tree-kill a dev server correctly). Add -WhatIf to preview without killing."
}

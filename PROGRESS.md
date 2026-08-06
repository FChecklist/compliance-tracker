# PROGRESS -- task-20260806-151345-critical-real-disk-exhaustion-root-files

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, no conflicting active claim found, registered own claim (commit afacd951, pushed)
- [x] Minted real child UMR via canonical registrar: `python3 /opt/veridian/scripts/superboss-register.py insert-owner-proposal` -> id=102, child_umr=`UMR-20260806-151559-30d5`
- [x] Confirmed live `df -h /` at 15:14Z: 301G size / 256G used / 33G avail / 89% -- differs materially from SPEC's 08:16Z snapshot (680M avail/100%); noted in claim, investigating regardless since 89%-full 301G root is still real risk

## Remaining
- [ ] Bounded `du` survey of /opt and /home top-level dirs to find real top consumer
- [ ] Check running veridian-worker systemd units + their real output paths for active ~250MB/min writer
- [ ] Reclaim only provably-regenerable artifacts (rotated logs, caches, temp, stale worker build output)
- [ ] Kill runaway worker unit if it is the real writer, record which unit
- [ ] Report any candidates outside the safe-reclaim list to PM with real sizes instead of deleting
- [ ] Add real disk-usage section to generate_pm_report_v3.py
- [ ] Record real reclaimed bytes, resulting df, commit, and file path into child UMR row (UMR-20260806-151559-30d5)
- [ ] Final commit + push

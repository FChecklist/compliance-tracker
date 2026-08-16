<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VERIDIAN AI — Orchestra AI</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script>
tailwind.config={theme:{extend:{fontFamily:{sans:['Space Grotesk','sans-serif'],mono:['JetBrains Mono','monospace']},colors:{bg:{DEFAULT:'#f0f1f4',card:'#ffffff',el:'#f7f8fa',hover:'#f3f4f6'},bdr:{DEFAULT:'#e2e5ea',lt:'#d1d5db',ll:'#eef0f3'},txt:{DEFAULT:'#111827',sec:'#6b7280',mu:'#9ca3af'},teal:{DEFAULT:'#0d9488',lt:'#14b8a6',dk:'#0f766e',bg:'#ecfdf5'},amber:{DEFAULT:'#d97706',lt:'#f59e0b',dk:'#b45309',bg:'#fffbeb'},coral:{DEFAULT:'#e11d48',lt:'#f43f5e',dk:'#be123c',bg:'#fff1f2'},cyan:{DEFAULT:'#0891b2',lt:'#06b6d4',dk:'#0e7490',bg:'#ecfeff'},lime:{DEFAULT:'#65a30d',lt:'#84cc16',dk:'#4d7c0f',bg:'#f7fee7'},indigo:{DEFAULT:'#4f46e5',lt:'#6366f1',dk:'#4338ca',bg:'#eef2ff'},slate:{DEFAULT:'#475569',bg:'#f1f5f9'}}}}}
</script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f0f1f4;color:#111827;font-family:'Space Grotesk',sans-serif;overflow:hidden;height:100vh}
.bg-amb{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 800px 500px at 3% 8%,rgba(79,70,229,.03) 0%,transparent 70%),radial-gradient(ellipse 600px 600px at 92% 82%,rgba(13,148,136,.03) 0%,transparent 70%),radial-gradient(ellipse 500px 400px at 50% 96%,rgba(217,119,6,.02) 0%,transparent 70%)}
.bg-dots{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.16;background-image:radial-gradient(circle,#d1d5db .6px,transparent .6px);background-size:24px 24px}
.cs::-webkit-scrollbar{width:3px}.cs::-webkit-scrollbar-track{background:transparent}.cs::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}
.h-line{height:2px;background:linear-gradient(90deg,transparent 4%,#4f46e5,#0d9488,#0891b2,#d97706,#e11d48,#65a30d,transparent 96%);opacity:.35}
.cg{position:relative}.cg::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;border-radius:10px 10px 0 0}
.cg[data-c="teal"]::before{background:linear-gradient(90deg,#0d9488,transparent 80%)}
.cg[data-c="amber"]::before{background:linear-gradient(90deg,#d97706,transparent 80%)}
.cg[data-c="coral"]::before{background:linear-gradient(90deg,#e11d48,transparent 80%)}
.cg[data-c="cyan"]::before{background:linear-gradient(90deg,#0891b2,transparent 80%)}
.cg[data-c="lime"]::before{background:linear-gradient(90deg,#65a30d,transparent 80%)}
@keyframes wp{0%,100%{opacity:1}50%{opacity:.25}}.pd{animation:wp 2s ease-in-out infinite}
@keyframes sp{to{transform:rotate(360deg)}}.ss{animation:sp 1.4s linear infinite}
@keyframes ca{0%{transform:scale(0)}60%{transform:scale(1.3)}100%{transform:scale(1)}}.ca{animation:ca .3s ease-out forwards}
@keyframes su{from{transform:translateY(5px);opacity:0}to{transform:translateY(0);opacity:1}}.su{animation:su .2s ease-out forwards}
@keyframes td{0%,80%,100%{transform:scale(.5);opacity:.3}40%{transform:scale(1);opacity:1}}
.td span{display:inline-block;width:4px;height:4px;border-radius:50%;background:#9ca3af;margin:0 1px}
.td span:nth-child(1){animation:td 1.4s ease-in-out infinite}
.td span:nth-child(2){animation:td 1.4s ease-in-out .2s infinite}
.td span:nth-child(3){animation:td 1.4s ease-in-out .4s infinite}
@keyframes ti{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}.t-i{animation:ti .3s ease-out forwards}
@keyframes to2{from{transform:translateX(0);opacity:1}to{transform:translateX(110%);opacity:0}}.t-o{animation:to2 .25s ease-in forwards}
@keyframes pi{from{transform:translateX(100%)}to{transform:translateX(0)}}.p-i{animation:pi .3s ease-out forwards}
@keyframes po{from{transform:translateX(0)}to{transform:translateX(100%)}}.p-o{animation:po .25s ease-in forwards}
.ti2{transition:background .15s,box-shadow .15s}.ti2:hover{background:#f7f8fa}
.ti2.sel{background:#f0fdf4;box-shadow:inset 0 0 0 1px #bbf7d0}
.sb{transition:all .2s;opacity:0;transform:translateX(3px);pointer-events:none}.sb.vis{opacity:1;transform:translateX(0);pointer-events:auto}.sb:hover{transform:scale(1.05)}
.ap{transition:filter .15s;cursor:default}.ap:hover{filter:brightness(.93)}
.cm{animation:su .2s ease-out}
.mc{width:7px;height:7px;border-radius:1.5px;transition:background .3s,box-shadow .3s}
.po2{position:fixed;inset:0;background:rgba(0,0,0,.1);z-index:90;opacity:0;pointer-events:none;transition:opacity .3s;backdrop-filter:blur(2px)}.po2.on{opacity:1;pointer-events:auto}
.acol{box-shadow:0 1px 3px rgba(0,0,0,.04),0 0 0 1px rgba(0,0,0,.03)}
@media(max-width:1400px){.ag{overflow-x:auto}.acol{min-width:258px;flex-shrink:0}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
</style>
</head>
<body class="relative">
<div class="bg-amb"></div><div class="bg-dots"></div>

<header class="relative z-50 bg-white/80 backdrop-blur-xl border-b border-bdr">
<div class="flex items-center justify-between px-4 h-11">
<div class="flex items-center gap-2">
<div class="w-6 h-6 rounded-md bg-gradient-to-br from-indigo to-indigo-lt flex items-center justify-center shadow-sm"><i class="fa-solid fa-cubes text-white text-[9px]"></i></div>
<span class="text-[13px] font-bold tracking-tight">VERIDIAN AI</span>
<span class="text-[9px] text-indigo bg-indigo-bg px-1.5 py-0.5 rounded-full border border-indigo/20 font-semibold">Orchestra</span>
</div>
<div class="flex-1 max-w-[170px] mx-4"><div class="relative"><i class="fa-solid fa-magnifying-glass absolute left-2 top-1/2 -translate-y-1/2 text-txt-mu text-[9px]"></i><input type="text" placeholder="Search tasks, agents..." class="w-full bg-bg-el border border-bdr rounded-md pl-7 pr-2 py-1 text-[10px] text-txt placeholder-txt-mu focus:outline-none focus:border-bdr-lt transition-all"></div></div>
<div class="flex items-center gap-1.5 bg-indigo-bg px-2 py-0.5 rounded-full border border-indigo/15"><span class="w-1.5 h-1.5 rounded-full bg-indigo pd"></span><span class="text-[9px] text-indigo font-semibold">15 Loops Active</span></div>
<div class="flex items-center gap-1.5 ml-3">
<button onclick="togglePanel()" class="flex items-center gap-1 px-2 py-1 rounded-md border border-bdr text-[10px] text-txt-sec hover:bg-bg-el hover:text-txt hover:border-bdr-lt transition-all font-medium"><i class="fa-solid fa-layer-group text-indigo text-[9px]"></i><span>Agent Library</span></button>
<button class="relative w-6 h-6 rounded-md bg-bg-el border border-bdr flex items-center justify-center text-txt-sec hover:text-txt transition-all" aria-label="Notifications"><i class="fa-solid fa-bell text-[9px]"></i><span class="absolute -top-1 -right-1 w-3 h-3 bg-coral rounded-full text-[7px] font-bold flex items-center justify-center text-white">3</span></button>
<div class="w-6 h-6 rounded-md bg-gradient-to-br from-teal-dk to-cyan-dk flex items-center justify-center text-[9px] font-bold text-white ring-1.5 ring-white" title="Rahul Kapoor · Senior CA">RK</div>
</div>
</div>
<div class="h-line"></div>
</header>

<main class="relative z-10 flex flex-col" style="height:calc(100vh - 46px)">
<div class="flex items-center gap-3 px-3 py-1 border-b border-bdr bg-white/40 backdrop-blur-sm">
<div class="flex items-center gap-1 text-[10px] text-txt-sec"><i class="fa-solid fa-robot text-indigo text-[9px]"></i><strong class="text-txt font-semibold">5</strong> Assistants</div>
<div class="w-px h-3 bg-bdr"></div>
<div class="flex items-center gap-1 text-[10px] text-txt-sec"><i class="fa-solid fa-list-check text-amber text-[9px]"></i><strong class="text-txt font-semibold" id="st-t">0</strong> Tasks</div>
<div class="w-px h-3 bg-bdr"></div>
<div class="flex items-center gap-1 text-[10px] text-txt-sec"><i class="fa-solid fa-circle-check text-lime-dk text-[9px]"></i><strong class="text-txt font-semibold" id="st-d">0</strong> Done</div>
<div class="w-px h-3 bg-bdr"></div>
<div class="flex items-center gap-1 text-[10px] text-txt-sec"><i class="fa-solid fa-clock text-coral text-[9px]"></i><strong class="text-txt font-semibold" id="st-r">0</strong> Review</div>
<div class="w-px h-3 bg-bdr"></div>
<div class="flex items-center gap-1 text-[10px] text-txt-sec"><i class="fa-solid fa-brain text-indigo text-[9px]"></i><strong class="text-txt font-semibold" id="st-l">0</strong> Learned</div>
<div class="flex-1"></div>
<div class="flex items-center gap-2.5 text-[8px] text-txt-mu">
<span class="flex items-center gap-1"><i class="fa-solid fa-circle text-teal" style="font-size:5px"></i>Global</span>
<span class="flex items-center gap-1"><i class="fa-solid fa-circle text-indigo" style="font-size:5px"></i>Firm</span>
<span class="flex items-center gap-1"><i class="fa-solid fa-circle text-amber" style="font-size:5px"></i>Client</span>
<span class="flex items-center gap-1"><i class="fa-solid fa-circle text-slate" style="font-size:5px"></i>User</span>
</div>
<div class="w-px h-3 bg-bdr ml-1"></div>
<div class="text-[9px] text-txt-mu font-mono ml-1" id="clk"></div>
</div>
<div class="ag flex gap-2 p-2 flex-1 overflow-hidden" id="ac"></div>
</main>

<div class="po2" id="pov" onclick="togglePanel()"></div>
<aside id="pnl" class="fixed top-0 right-0 bottom-0 w-[440px] z-[100] bg-white border-l border-bdr flex flex-col hidden shadow-2xl" role="dialog" aria-label="Agent Library">
<div class="flex items-center justify-between px-4 py-3 border-b border-bdr">
<div><h2 class="text-xs font-semibold">Agent Library</h2><p class="text-[10px] text-txt-sec mt-0.5">4 Tiers · <span id="lib-cnt">0</span> Agents</p></div>
<button onclick="togglePanel()" class="w-6 h-6 rounded-md bg-bg-el border border-bdr flex items-center justify-center text-txt-sec hover:text-txt transition-colors" aria-label="Close"><i class="fa-solid fa-xmark text-[10px]"></i></button>
</div>
<div class="flex border-b border-bdr px-3" id="ltabs"></div>
<div class="flex-1 overflow-y-auto cs p-3" id="pcon"></div>
<div class="px-4 py-2 border-t border-bdr bg-bg-el/50"><p class="text-[8px] text-txt-mu leading-relaxed">Agents self-improve via 15 continuous loops. Global agents learn from anonymized patterns across all firms. Lower-tier agents are scoped to their boundary.</p></div>
</aside>

<div id="tc" class="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 items-end"></div>

<script>
// ─── WORKER AGENT LIBRARY (4 TIERS) ────────────────────────────────────
const WA={
// GLOBAL TIER
'g-tds-calc':{n:'TDS Calculation',t:'global',d:'India Tax > Direct Tax',ic:'fa-calculator',u:14520,ac:99.2},
'g-tds-file':{n:'TDS Return Filing',t:'global',d:'India Tax > Direct Tax',ic:'fa-file-invoice',u:8930,ac:98.7},
'g-tds-form':{n:'TDS Form Generation',t:'global',d:'India Tax > Direct Tax',ic:'fa-file-lines',u:7210,ac:99.5},
'g-adv-tax':{n:'Advance Tax Scheduler',t:'global',d:'India Tax > Direct Tax',ic:'fa-coins',u:5430,ac:97.8},
'g-itc':{n:'ITC Reconciliation',t:'global',d:'India Tax > Indirect Tax',ic:'fa-arrows-left-right',u:12800,ac:98.1},
'g-gstr1':{n:'GSTR-1 Filing',t:'global',d:'India Tax > Indirect Tax',ic:'fa-file-export',u:11200,ac:99.0},
'g-gstr3b':{n:'GSTR-3B Filing',t:'global',d:'India Tax > Indirect Tax',ic:'fa-file-import',u:11800,ac:99.3},
'g-eway':{n:'E-Way Bill Manager',t:'global',d:'India Tax > Indirect Tax',ic:'fa-truck',u:6500,ac:97.5},
'g-einv':{n:'E-Invoice Compliance',t:'global',d:'India Tax > Indirect Tax',ic:'fa-qrcode',u:5800,ac:98.9},
'g-itr':{n:'ITR Filing (1-7)',t:'global',d:'India Tax > Direct Tax',ic:'fa-file-signature',u:9200,ac:97.2},
'g-audit':{n:'Tax Audit Report',t:'global',d:'India Tax > Direct Tax',ic:'fa-clipboard-check',u:4300,ac:96.8},
'g-roc-aoc':{n:'AOC-4 Filing',t:'global',d:'India Compliance > ROC',ic:'fa-landmark',u:6700,ac:99.1},
'g-roc-mgt':{n:'MGT-7 Filing',t:'global',d:'India Compliance > ROC',ic:'fa-building-columns',u:5900,ac:98.5},
'g-din':{n:'DIN/DSC Manager',t:'global',d:'India Compliance > ROC',ic:'fa-id-card',u:3200,ac:99.8},
'g-pf-esi':{n:'PF/ESI Filing',t:'global',d:'India Compliance > Labour',ic:'fa-shield-heart',u:4800,ac:98.0},
'g-proftax':{n:'Professional Tax',t:'global',d:'India Compliance > Labour',ic:'fa-receipt',u:3900,ac:99.6},
'g-cal':{n:'Compliance Calendar',t:'global',d:'India Compliance',ic:'fa-calendar-days',u:18200,ac:99.9},
'g-penalty':{n:'Penalty Calculator',t:'global',d:'India Compliance',ic:'fa-triangle-exclamation',u:4100,ac:99.4},
'g-journal':{n:'Journal Entry Bot',t:'global',d:'Accounting',ic:'fa-pen-ruler',u:15600,ac:98.3},
'g-bankrec':{n:'Bank Reconciliation',t:'global',d:'Accounting',ic:'fa-building-columns',u:13400,ac:97.9},
'g-interco':{n:'Inter-company Rec',t:'global',d:'Accounting',ic:'fa-right-left',u:5200,ac:96.5},
'g-fixed':{n:'Fixed Asset Accounting',t:'global',d:'Accounting',ic:'fa-chair',u:4700,ac:98.2},
'g-finstmt':{n:'Financial Statements',t:'global',d:'Accounting',ic:'fa-chart-pie',u:8900,ac:97.1},
'g-internal-audit':{n:'Internal Audit Plan',t:'global',d:'Audit',ic:'fa-magnifying-glass-chart',u:3100,ac:95.8},
'g-risk':{n:'Risk Assessment',t:'global',d:'Audit',ic:'fa-shield-halved',u:3800,ac:94.5},
'g-control':{n:'Control Testing',t:'global',d:'Audit',ic:'fa-vial',u:3500,ac:96.2},
'g-sample':{n:'Sample Selector',t:'global',d:'Audit',ic:'fa-dice',u:2900,ac:97.7},
'g-cash':{n:'Cash Position Mgmt',t:'global',d:'Treasury',ic:'fa-wallet',u:7200,ac:98.6},
'g-forecast':{n:'Cash Flow Forecast',t:'global',d:'Treasury',ic:'fa-water',u:5100,ac:94.2},
'g-fx':{n:'FX Exposure Manager',t:'global',d:'Treasury',ic:'fa-globe',u:3400,ac:93.8},
'g-ocr':{n:'Document Parser',t:'global',d:'Cross-Cutting',ic:'fa-file-image',u:22100,ac:96.5},
'g-anomaly':{n:'Anomaly Detector',t:'global',d:'Cross-Cutting',ic:'fa-wave-square',u:8400,ac:93.1},
'g-report':{n:'Report Generator',t:'global',d:'Cross-Cutting',ic:'fa-file-pdf',u:19300,ac:97.8},
// FIRM TIER
'f-close-wf':{n:'Month-End Close WF',t:'firm',d:'Shah & Co > Processes',ic:'fa-arrows-spin',u:340,ac:97.5},
'f-tds-review':{n:'TDS Review Checklist',t:'firm',d:'Shah & Co > Processes',ic:'fa-list-check',u:280,ac:98.2},
'f-onboard':{n:'Client Onboarding',t:'firm',d:'Shah & Co > Processes',ic:'fa-user-plus',u:45,ac:96.0},
'f-templates':{n:'Communication Templates',t:'firm',d:'Shah & Co > Standards',ic:'fa-envelope',u:1200,ac:99.1},
'f-approval':{n:'Approval Chain Config',t:'firm',d:'Shah & Co > Policies',ic:'fa-sitemap',u:890,ac:99.8},
'f-manufact-itc':{n:'Manufacturing ITC Rules',t:'firm',d:'Shah & Co > Domain',ic:'fa-industry',u:210,ac:97.3},
// CLIENT TIER
'c-abc-gst':{n:'ABC Corp GST Pattern',t:'client',d:'ABC Corp > GST',ic:'fa-building',u:78,ac:99.5},
'c-abc-tds':{n:'ABC Corp TDS Exceptions',t:'client',d:'ABC Corp > TDS',ic:'fa-building',u:52,ac:100},
'c-abc-approvals':{n:'ABC Corp Approval Chain',t:'client',d:'ABC Corp > Policy',ic:'fa-building',u:34,ac:100},
'c-def-bank':{n:'DEF Inc Bank Pattern',t:'client',d:'DEF Inc > Banking',ic:'fa-building',u:41,ac:98.0},
'c-ghi-risk':{n:'GHI Holdings Risk Profile',t:'client',d:'GHI Holdings > Risk',ic:'fa-building',u:28,ac:95.5},
// USER TIER
'u-rahul-priority':{n:'Rahul Task Priority',t:'user',d:'Personal > Behavior',ic:'fa-user',u:245,ac:92.0},
'u-rahul-style':{n:'Rahul Review Style',t:'user',d:'Personal > Preference',ic:'fa-user',u:198,ac:94.5},
'u-rahul-hours':{n:'Rahul Active Hours',t:'user',d:'Personal > Pattern',ic:'fa-user',u:312,ac:99.0},
};

const TC={global:{c:'teal',bg:'bg-teal-bg',tx:'text-teal',bd:'border-teal/20',label:'Global'},firm:{c:'indigo',bg:'bg-indigo-bg',tx:'text-indigo',bd:'border-indigo/20',label:'Firm'},client:{c:'amber',bg:'bg-amber-bg',tx:'text-amber',bd:'border-amber/20',label:'Client'},user:{c:'slate',bg:'bg-slate-bg',tx:'text-slate',bd:'border-slate/20',label:'User'}};

const CC={teal:{bg:'bg-teal-bg',tx:'text-teal',dk:'text-teal-dk',dot:'bg-teal',fill:'#0d9488'},amber:{bg:'bg-amber-bg',tx:'text-amber',dk:'text-amber-dk',dot:'bg-amber',fill:'#d97706'},coral:{bg:'bg-coral-bg',tx:'text-coral',dk:'text-coral-dk',dot:'bg-coral',fill:'#e11d48'},cyan:{bg:'bg-cyan-bg',tx:'text-cyan',dk:'text-cyan-dk',dot:'bg-cyan',fill:'#0891b2'},lime:{bg:'bg-lime-bg',tx:'text-lime',dk:'text-lime-dk',dot:'bg-lime',fill:'#65a30d'}};

// ─── ASSISTANT DATA ─────────────────────────────────────────────────────
let learnCount=0;
const learnMsgs=['Created User Agent: Rahul TDS Shortcut','Updated Client Agent: ABC Corp Filing Pref','Improved Firm Agent: Close Workflow v3','Detected pattern → new User Agent queued','Refined Global Agent call sequence','Updated Client Agent: DEF Bank Rec Rule','Learned: Rahul prefers detailed outputs','Firm Agent updated: Manufacturing ITC check'];

let assistants=[
{id:'a1',label:'Assistant 1',ck:'teal',status:'working',
wids:['g-tds-calc','g-tds-file','f-tds-review','c-abc-tds','u-rahul-priority'],
m:[{l:'Deadlines',v:'3 upcoming',tr:'w'},{l:'Tax Liability',v:'₹2.4Cr',tr:'n'}],
tasks:[
{id:'t1',tx:'File Q3 GST returns for ABC Corp',cl:'ABC Corp',st:'completed',ac:true},
{id:'t2',tx:'Review TDS deductions — XYZ Ltd',cl:'XYZ Ltd',st:'in-progress',ac:false},
{id:'t3',tx:'Advance tax computation — MNO',cl:'MNO Pvt Ltd',st:'pending',ac:false},
{id:'t4',tx:'E-way bill audit — PQR Industries',cl:'PQR Industries',st:'pending',ac:false},
],
chat:[{f:'a',tx:'Orchestrated: TDS Calculation + TDS Filing agents for XYZ Ltd review. Running now.'}]},
{id:'a2',label:'Assistant 2',ck:'amber',status:'working',
wids:['g-journal','g-bankrec','f-close-wf','c-def-bank','u-rahul-style'],
m:[{l:'Close Progress',v:'67%',tr:'g'},{l:'Journal Entries',v:'12 pending',tr:'w'}],
tasks:[
{id:'t5',tx:'Month-end close entries — ABC Corp',cl:'ABC Corp',st:'completed',ac:true},
{id:'t6',tx:'Bank reconciliation — DEF Inc',cl:'DEF Inc',st:'in-progress',ac:false},
{id:'t7',tx:'P&L variance analysis — ABC Corp',cl:'ABC Corp',st:'pending',ac:false},
{id:'t8',tx:'Inter-company eliminations — DEF',cl:'DEF Inc',st:'pending',ac:false},
],
chat:[{f:'a',tx:'Bank Rec agent found 2 mismatches for DEF Inc. Reconciling with Client Agent pattern.'}]},
{id:'a3',label:'Assistant 3',ck:'coral',status:'idle',
wids:['g-internal-audit','g-control','g-risk','c-ghi-risk','u-rahul-hours'],
m:[{l:'High Risks',v:'4 found',tr:'w'},{l:'Controls',v:'23/30',tr:'g'}],
tasks:[
{id:'t9',tx:'Internal audit plan — ABC Corp',cl:'ABC Corp',st:'completed',ac:true},
{id:'t10',tx:'Control testing — GHI Holdings',cl:'GHI Holdings',st:'in-progress',ac:false},
{id:'t11',tx:'Risk assessment update — ABC Corp',cl:'ABC Corp',st:'pending',ac:false},
{id:'t12',tx:'Findings report — GHI Holdings',cl:'GHI Holdings',st:'pending',ac:false},
],
chat:[{f:'a',tx:'Ready. Control Testing agent queued for GHI Holdings. Risk Profile agent loaded.'}]},
{id:'a4',label:'Assistant 4',ck:'cyan',status:'working',
wids:['g-roc-aoc','g-roc-mgt','g-cal','f-approval','c-abc-approvals'],
m:[{l:'Filings Due',v:'5 this week',tr:'w'},{l:'Penalties',v:'₹0',tr:'g'}],
tasks:[
{id:'t13',tx:'Annual return filing — XYZ Ltd',cl:'XYZ Ltd',st:'in-progress',ac:false},
{id:'t14',tx:'DIN KYC update — JKL Associates',cl:'JKL Associates',st:'pending',ac:false},
{id:'t15',tx:'Form MGT-7 filing — MNO Pvt Ltd',cl:'MNO Pvt Ltd',st:'pending',ac:false},
{id:'t16',tx:'Compliance calendar sync — all',cl:'All Clients',st:'pending',ac:false},
],
chat:[{f:'a',tx:'AOC-4 + MGT-7 agents working for XYZ Ltd. Compliance Calendar agent syncing deadlines.'}]},
{id:'a5',label:'Assistant 5',ck:'lime',status:'working',
wids:['g-cash','g-forecast','g-fx','c-abc-gst','u-rahul-priority'],
m:[{l:'Cash Position',v:'₹8.2Cr',tr:'g'},{l:'FX Positions',v:'3 open',tr:'n'}],
tasks:[
{id:'t17',tx:'Daily cash position — ABC Corp',cl:'ABC Corp',st:'completed',ac:true},
{id:'t18',tx:'Bank rec completion — DEF Inc',cl:'DEF Inc',st:'in-progress',ac:false},
{id:'t19',tx:'FX exposure report — ABC Corp',cl:'ABC Corp',st:'pending',ac:false},
{id:'t20',tx:'Investment maturity alert — DEF',cl:'DEF Inc',st:'pending',ac:false},
],
chat:[{f:'a',tx:'Cash Position agent: ABC Corp ₹5.1Cr across 3 banks. Forecast agent running projections.'}]},
];

let selTasks={};
let panelOpen=false,panelTab='global';

// ─── HELPERS ────────────────────────────────────────────────────────────
const gw=id=>WA[id];
const ga=id=>assistants.find(a=>a.id===id);
const cnts=a=>{const t=a.tasks.length,c=a.tasks.filter(x=>x.st==='completed'||x.st==='submitted').length;return{t,c}};
const gcnts=()=>{let t=0,c=0,r=0;assistants.forEach(a=>a.tasks.forEach(x=>{t++;if(x.st==='submitted')c++;else if(x.st==='completed')r++}));return{t,c,r}};

// ─── RENDER ─────────────────────────────────────────────────────────────
function render(){
document.getElementById('ac').innerHTML=assistants.map(a=>renderCol(a)).join('');
assistants.forEach(a=>{const e=document.getElementById('ch-'+a.id);if(e)e.scrollTop=e.scrollHeight});
updSum();
}

function renderCol(a){
const c=CC[a.ck],cn=cnts(a),si=selTasks[a.id]||null;
const st=si?a.tasks.find(x=>x.id===si):null;
const agents=a.wids.map(id=>gw(id)).filter(Boolean);
// Group agents by tier for display
const tiers={global:[],firm:[],client:[],user:[]};
agents.forEach(ag=>{if(tiers[ag.t])tiers[ag.t].push(ag)});
return`<div class="acol cg flex-1 min-w-0 flex flex-col bg-white border border-bdr rounded-xl overflow-hidden" data-c="${a.ck}">
<div class="flex items-center gap-2 px-2.5 py-1.5 border-b border-bdr-ll">
<div class="w-5 h-5 rounded-md ${c.bg} flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-robot ${c.tx} text-[9px]"></i></div>
<div class="flex-1 min-w-0"><div class="flex items-center gap-1"><span class="text-[11px] font-semibold truncate">${a.label}</span><span class="w-1.5 h-1.5 rounded-full flex-shrink-0 ${a.status==='working'?c.dot+' pd':'bg-txt-mu/30'}"></span>${a.status==='working'?`<span class="text-[8px] ${c.tx} font-medium">Active</span>`:`<span class="text-[8px] text-txt-mu">Idle</span>`}</div></div>
</div>
<div class="px-2.5 py-1 border-b border-bdr-ll flex items-center gap-1.5">
<span class="text-[8px] text-txt-mu font-semibold uppercase tracking-wider">Matrix</span>
<div class="flex gap-[2px] flex-1">${mtx(cn.t,cn.c,c.fill)}</div>
<span class="text-[9px] font-mono ${c.tx} font-semibold">${cn.c}/${cn.t}</span>
</div>
<div class="px-2 py-0.5 border-b border-bdr-ll flex gap-[2px] overflow-x-auto" style="scrollbar-width:none">
 ${tiers.global.map(ag=>`<span class="ap inline-flex items-center gap-[2px] px-1 py-[1px] rounded text-[7px] text-teal bg-teal-bg whitespace-nowrap border border-teal/15"><i class="fa-solid ${ag.ic}" style="font-size:5px"></i>${ag.n}</span>`).join('')}
 ${tiers.firm.map(ag=>`<span class="ap inline-flex items-center gap-[2px] px-1 py-[1px] rounded text-[7px] text-indigo bg-indigo-bg whitespace-nowrap border border-indigo/15"><i class="fa-solid ${ag.ic}" style="font-size:5px"></i>${ag.n}</span>`).join('')}
 ${tiers.client.map(ag=>`<span class="ap inline-flex items-center gap-[2px] px-1 py-[1px] rounded text-[7px] text-amber bg-amber-bg whitespace-nowrap border border-amber/15"><i class="fa-solid ${ag.ic}" style="font-size:5px"></i>${ag.n}</span>`).join('')}
 ${tiers.user.map(ag=>`<span class="ap inline-flex items-center gap-[2px] px-1 py-[1px] rounded text-[7px] text-slate bg-slate-bg whitespace-nowrap border border-slate/15"><i class="fa-solid ${ag.ic}" style="font-size:5px"></i>${ag.n}</span>`).join('')}
</div>
<div class="px-2 py-1 border-b border-bdr-ll grid grid-cols-2 gap-1">
 ${a.m.map(m=>`<div class="bg-bg-el rounded-md px-1.5 py-[3px]"><div class="text-[8px] text-txt-mu leading-tight">${m.l}</div><div class="text-[10px] font-semibold font-mono leading-tight mt-[1px] ${m.tr==='g'?'text-lime-dk':m.tr==='w'?'text-amber-dk':'text-txt'}">${m.v}</div></div>`).join('')}
</div>
<div class="flex-1 overflow-y-auto cs px-1 py-0.5" style="min-height:0">${a.tasks.map(t=>renderTask(a.id,t,si,c)).join('')}</div>
<div class="border-t border-bdr-ll px-2 py-1 overflow-y-auto cs" style="height:82px;min-height:82px" id="ch-${a.id}">${a.chat.map(m=>renderMsg(m,c)).join('')}</div>
<div class="border-t border-bdr px-1.5 py-1 flex gap-1 bg-bg-el/30">
<input type="text" id="inp-${a.id}" placeholder="${st?'Instruct: '+st.tx.slice(0,25)+'...':'Message '+a.label+'...'}" class="flex-1 bg-white border border-bdr rounded-md px-2 py-[3px] text-[10px] text-txt placeholder-txt-mu focus:outline-none focus:border-bdr-lt transition-all" onkeydown="if(event.key==='Enter')sendMsg('${a.id}')" aria-label="Chat for ${a.label}">
<button onclick="sendMsg('${a.id}')" class="w-6 h-6 rounded-md ${c.bg} ${c.tx} flex items-center justify-center hover:opacity-80 transition-opacity flex-shrink-0" aria-label="Send"><i class="fa-solid fa-paper-plane text-[8px]"></i></button>
</div>
</div>`}

function mtx(total,done,fill){let s='';for(let i=0;i<10;i++){const f=i<done,a2=i<total;s+=`<div class="mc" style="background:${f?fill:a2?'#e5e7eb':'transparent'};${f?'box-shadow:0 0 4px '+fill+'30;':''}"></div>`}return s}

function renderTask(aid,t,si,c){
const sel=t.id===si;let cb='',bd='',sb='';
if(t.st==='pending'){cb=`<div class="w-3 h-3 rounded border border-bdr-lt flex-shrink-0"></div>`;bd=`<span class="text-[7px] text-txt-mu bg-bg-el px-1 py-[1px] rounded-full font-medium">Pending</span>`}
else if(t.st==='in-progress'){cb=`<div class="w-3 h-3 rounded border border-amber/40 flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-spinner ss text-amber" style="font-size:6px"></i></div>`;bd=`<span class="text-[7px] text-amber-dk bg-amber-bg px-1 py-[1px] rounded-full font-medium">Working</span>`}
else if(t.st==='completed'){cb=`<div class="w-3 h-3 rounded border-2 border-lime flex items-center justify-center flex-shrink-0 ca"><i class="fa-solid fa-check text-lime-dk" style="font-size:6px"></i></div>`;bd=`<span class="text-[7px] text-amber-dk bg-amber-bg px-1 py-[1px] rounded-full font-medium">Review</span>`;sb=`<button onclick="event.stopPropagation();submitTask('${aid}','${t.id}')" class="sb vis text-[7px] font-semibold px-1.5 py-[1px] rounded bg-teal text-white hover:bg-teal-dk transition-colors">Submit</button>`}
else{cb=`<div class="w-3 h-3 rounded border-2 border-bdr flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-check text-txt-mu" style="font-size:6px"></i></div>`;bd=`<span class="text-[7px] text-lime-dk bg-lime-bg px-1 py-[1px] rounded-full font-medium">Done</span>`}
return`<div class="ti2 flex items-center gap-1 px-1 py-[4px] rounded-md border border-transparent cursor-pointer ${sel?'sel':''}" onclick="selTask('${aid}','${t.id}')">${cb}<div class="flex-1 min-w-0"><div class="text-[9px] leading-tight ${t.st==='submitted'?'text-txt-mu line-through':'text-txt'} truncate">${t.tx}</div><div class="text-[7px] text-txt-mu leading-tight mt-[1px]">${t.cl}</div></div><div class="flex items-center gap-[3px] flex-shrink-0">${sb}${bd}</div></div>`}

function renderMsg(m,c){
if(m.f==='u')return`<div class="cm flex justify-end mb-1"><div class="bg-teal/8 border border-teal/12 rounded-lg rounded-tr-sm px-2 py-1 max-w-[90%]"><p class="text-[9px] text-txt leading-relaxed">${m.tx}</p>${m.tr?`<span class="text-[7px] text-teal mt-[1px] block">Re: ${m.tr}</span>`:''}</div></div>`;
if(m.f==='s')return`<div class="cm flex justify-center mb-1"><div class="bg-bg-el rounded-full px-2 py-[2px] flex items-center gap-1"><i class="fa-solid fa-circle-check text-lime-dk" style="font-size:7px"></i><span class="text-[8px] text-txt-sec">${m.tx}</span></div></div>`;
if(m.f==='l')return`<div class="cm flex justify-center mb-1"><div class="bg-indigo-bg rounded-full px-2 py-[2px] flex items-center gap-1"><i class="fa-solid fa-brain text-indigo" style="font-size:7px"></i><span class="text-[8px] text-indigo">${m.tx}</span></div></div>`;
if(m.f==='th')return`<div class="cm flex justify-start mb-1"><div class="bg-bg-el border border-bdr-ll rounded-lg rounded-tl-sm px-2 py-1"><div class="td"><span></span><span></span><span></span></div></div></div>`;
return`<div class="cm flex justify-start mb-1"><div class="bg-bg-el border border-bdr-ll rounded-lg rounded-tl-sm px-2 py-1 max-w-[90%]"><p class="text-[9px] text-txt-sec leading-relaxed">${m.tx}</p></div></div>`}

function updSum(){const g=gcnts();document.getElementById('st-t').textContent=g.t;document.getElementById('st-d').textContent=g.c;document.getElementById('st-r').textContent=g.r;document.getElementById('st-l').textContent=learnCount}

// ─── ACTIONS ────────────────────────────────────────────────────────────
function selTask(aid,tid){selTasks[aid]=selTasks[aid]===tid?null:tid;render();setTimeout(()=>{const i=document.getElementById('inp-'+aid);if(i)i.focus()},30)}

function sendMsg(aid){
const inp=document.getElementById('inp-'+aid),tx=inp.value.trim();if(!tx)return;
const a=ga(aid),si=selTasks[aid];let tr=null;if(si){const t=a.tasks.find(x=>x.id===si);if(t)tr=t.tx}
a.chat.push({f:'u',tx,tr});a.chat.push({f:'th'});inp.value='';
setTimeout(()=>{
const r=[`Orchestrating agents for${tr?' — '+tr.slice(0,30)+'...':' this task'}. Running now.`,'Received. Adjusting agent parameters and re-executing.','Noted. Updating Worker Agent sequence with your input.','Understood. Re-processing with revised instructions.','Acknowledged. Rerouting to optimal agent combination.'];
a.chat=a.chat.filter(x=>x.f!=='th');a.chat.push({f:'a',tx:r[Math.floor(Math.random()*r.length)]});
render()},900+Math.random()*600);
render()}

function submitTask(aid,tid){
const a=ga(aid),t=a.tasks.find(x=>x.id===tid);if(!t||t.st!=='completed')return;
t.st='submitted';a.chat.push({f:'s',tx:`"${t.tx.slice(0,35)}..." submitted`});
if(!a.tasks.some(x=>x.st==='in-progress'||x.st==='pending'))a.status='idle';
toast(`${a.label}: ${t.tx.slice(0,30)} — submitted`,'success');render()}

function autoComp(aid,tid){
const a=ga(aid),t=a.tasks.find(x=>x.id===tid);if(!t||t.st!=='in-progress')return;
t.st='completed';t.ac=true;
// Simulate learning event
if(Math.random()>0.5){learnCount++;const lm=learnMsgs[Math.floor(Math.random()*learnMsgs.length)];a.chat.push({f:'l',tx:lm})}
a.chat.push({f:'s',tx:`Done: "${t.tx.slice(0,35)}..." — review`});
toast(`${a.label} completed: ${t.tx.slice(0,30)}`,'info');render()}

// ─── PANEL ──────────────────────────────────────────────────────────────
function togglePanel(){
panelOpen=!panelOpen;const p=document.getElementById('pnl'),o=document.getElementById('pov');
if(panelOpen){p.classList.remove('hidden','p-o');p.classList.add('p-i');o.classList.add('on');renderTabs();renderLib()}
else{p.classList.remove('p-i');p.classList.add('p-o');o.classList.remove('on');setTimeout(()=>p.classList.add('hidden'),250)}
}

function renderTabs(){
const tiers=['global','firm','client','user'];
const counts={};tiers.forEach(t=>{counts[t]=Object.values(WA).filter(a=>a.t===t).length});
document.getElementById('ltabs').innerHTML=tiers.map(t=>{
const tc=TC[t],cnt=counts[t];
return`<button onclick="switchTab('${t}')" id="lt-${t}" class="px-2.5 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${panelTab===t?tc.tx+' border-current':'text-txt-mu border-transparent hover:text-txt-sec'}">${tc.label} <span class="opacity-60">${cnt}</span></button>`
}).join('')}

function switchTab(t){
panelTab=t;renderTabs();renderLib();
document.getElementById('ltabs').querySelectorAll('button').forEach(b=>{b.className=b.className.replace(/border-current|text-\S+/g,'')});
const tc=TC[t];const btn=document.getElementById('lt-'+t);
btn.classList.add(tc.tx,'border-current');btn.classList.remove('text-txt-mu')}

function renderLib(){
const agents=Object.entries(WA).filter(([k,v])=>v.t===panelTab).sort((a,b)=>b[1].u-a[1].u);
const tc=TC[panelTab];
document.getElementById('lib-cnt').textContent=Object.keys(WA).length;
document.getElementById('pcon').innerHTML=`
<div class="text-[10px] text-txt-sec mb-2">${agents.length} ${tc.label} Worker Agents · Sorted by usage</div>
<div class="grid gap-1.5">${agents.map(([id,ag])=>{
const usedBy=assistants.filter(a=>a.wids.includes(id));
return`<div class="bg-bg-el border border-bdr-ll rounded-lg p-2 hover:border-bdr transition-colors">
<div class="flex items-start gap-2">
<div class="w-6 h-6 rounded-md ${tc.bg} flex items-center justify-center flex-shrink-0"><i class="fa-solid ${ag.ic} ${tc.tx} text-[9px]"></i></div>
<div class="flex-1 min-w-0">
<div class="flex items-center gap-1.5"><span class="text-[10px] font-semibold">${ag.n}</span>${ag.t==='global'?'<span class="text-[7px] text-txt-mu bg-white px-1 py-[1px] rounded border border-bdr-ll">Immutable</span>':''}</div>
<div class="text-[9px] text-txt-sec mt-[1px]">${ag.d}</div>
<div class="flex items-center gap-3 mt-1">
<span class="text-[8px] text-txt-mu font-mono">${ag.u.toLocaleString()} uses</span>
<span class="text-[8px] font-mono ${ag.ac>98?'text-lime-dk':ag.ac>95?'text-amber-dk':'text-coral-dk'}">${ag.ac}% acc</span>
</div>
 ${usedBy.length?`<div class="flex flex-wrap gap-1 mt-1">${usedBy.map(a=>{const x=CC[a.ck];return`<span class="text-[7px] ${x.tx} ${x.bg} px-1 py-[1px] rounded-full border ${x.bg.replace('bg-','border-').replace('/','/')}">${a.label}</span>`}).join('')}</div>`:''}
</div>
</div>
</div>`}).join('')}</div>`}

// ─── TOAST ──────────────────────────────────────────────────────────────
function toast(msg,type='info'){
const c=document.getElementById('tc');
const cls={info:'border-indigo/25 bg-white shadow-lg',success:'border-lime/25 bg-white shadow-lg',warning:'border-amber/25 bg-white shadow-lg'};
const ics={info:'fa-circle-info text-indigo',success:'fa-circle-check text-lime-dk',warning:'fa-triangle-exclamation text-amber'};
const t=document.createElement('div');
t.className=`t-i flex items-center gap-2 px-3 py-2 rounded-xl border ${cls[type]} max-w-xs`;
t.innerHTML=`<i class="fa-solid ${ics[type]} text-[10px] flex-shrink-0"></i><span class="text-[10px] text-txt">${msg}</span>`;
c.appendChild(t);setTimeout(()=>{t.classList.remove('t-i');t.classList.add('t-o');setTimeout(()=>t.remove(),250)},3500);
}

// ─── CLOCK ──────────────────────────────────────────────────────────────
function updClk(){const n=new Date();document.getElementById('clk').textContent=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')} IST`}
setInterval(updClk,1000);updClk();

// ─── SIMULATION ─────────────────────────────────────────────────────────
function sim(){
assistants.forEach(a=>{
const ip=a.tasks.filter(t=>t.st==='in-progress');
if(ip.length>0&&Math.random()>0.4){autoComp(a.id,ip[Math.floor(Math.random()*ip.length)].id)}
if(!a.tasks.some(t=>t.st==='in-progress')){
const pn=a.tasks.filter(t=>t.st==='pending');
if(pn.length>0&&Math.random()>0.5){
const t=pn[0];t.st='in-progress';a.status='working';
const agentsCalled=a.wids.slice(0,2+Math.floor(Math.random()*2)).map(id=>gw(id)).filter(Boolean).map(x=>x.n).join(' + ');
a.chat.push({f:'s',tx:`Started: "${t.tx.slice(0,35)}..."`});
a.chat.push({f:'a',tx:`Orchestrated: ${agentsCalled}`});
render()}}});
}

// First sim at 4s, then every 10s
setTimeout(()=>{sim();setInterval(sim,10000)},4000);

// ─── INIT ───────────────────────────────────────────────────────────────
render();
</script>
</body>
</html>
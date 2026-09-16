'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,ChevronRight,GitBranch,LockKeyhole,Pause,Play,RotateCcw} from 'lucide-react';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {scenarios,type Scenario} from '@/constants/landing-demo';
import {useDemoSequence} from './use-demo-sequence';
import {DemoColumns} from './demo-columns';
import {CursorLayer} from './cursor-layer';
import {useDemoLocalState} from './use-demo-local-state';
import type {DemoSelection} from './demo-selection';
import {DEMO_AUTO_HINT,DEMO_MANUAL_HINT} from '@/constants/landing-hero';
function DemoPlayer({scenario:s}:{scenario:Scenario}){
 const root=useRef<HTMLDivElement>(null);const [boundary,setBoundary]=useState<HTMLDivElement|null>(null);const attachRoot=useCallback((node:HTMLDivElement|null)=>{root.current=node;setBoundary(node)},[]);const seq=useDemoSequence(s,root);const {view:v}=seq;
 const local=useDemoLocalState(s);
 const [selection,setSelection]=useState<DemoSelection|null>(null);
 const [bubble,setBubble]=useState<DemoSelection|null>(null);
 const [resetTick,setResetTick]=useState(0);
 const resetDemo=useCallback(()=>{local.api.reset();setSelection(null);setBubble(null);setResetTick(t=>t+1);seq.jump(0)},[local,seq]);
 const chapterTimes=[0,5000,10000,16000,s.artifact?31000:28000];const chapters=['从主线开始','沿着一句话追问','深入分支','再问一个细节',s.artifact?'把结论带回主线':'三列并排看'];
 const current=chapterTimes.reduce((a,t,i)=>seq.elapsed>=t?i:a,0);
 useEffect(()=>{const cols=root.current?.querySelector('.cols');const target=cols?.querySelector(v.mentionOpen||v.referenceSelected||v.returned?'#thread-lane-0':`#thread-lane-${v.visible-1}`);if(cols&&target)cols.scrollTo({left:cols.scrollLeft+target.getBoundingClientRect().left-cols.getBoundingClientRect().left,behavior:'smooth'})},[v.visible,v.mentionOpen,v.referenceSelected,v.returned,seq.generation]);
 return <div className="hero-experience" ref={attachRoot}><div className="scenario-heading"><div><h3>{s.title}</h3><p>{s.description}</p></div><span className="demo-status"><i/>可交互演示</span></div>
 <div className="browser-mockup"><div className="browser-chrome"><div className="traffic-lights"><i/><i/><i/></div><div className="browser-tab"><GitBranch size={13}/>Thread Chat · 分支对话<span>×</span></div><span className="browser-plus">+</span></div><div className="browser-address"><span className="browser-history"><ArrowLeft size={13}/><ArrowRight size={13}/></span><div><LockKeyhole size={11}/>threadchat.zilin.im / thread-chat / {s.id}</div></div>
 <DemoColumns key={`${s.id}-${resetTick}`} scenario={s} view={v} interact={seq.interact} dismissOverlay={seq.dismissOverlay} boundary={boundary} local={local} onResetDemo={resetDemo} selection={selection} onSelection={setSelection} bubble={bubble} onBubble={setBubble} generation={seq.generation}/>
 </div>
 <CursorLayer root={root} cursor={seq.playing?v.cursor:{target:null,clicking:false}}/>
 <div className="chapter-controls"><button className="play-control" onClick={seq.toggle}>{seq.playing?<Pause size={16}/>:<Play size={16}/>}<span>{seq.playing?'暂停演示':seq.manual||seq.elapsed>=seq.duration?'重新演示':seq.elapsed?'继续演示':'播放演示'}</span></button><div className="chapter-list" aria-label="演示章节">{chapters.map((label,i)=><button key={label} className={`chapter ${current===i?'active':''}`} aria-current={current===i?'step':undefined} onClick={()=>seq.jump(chapterTimes[i])}><span className="chapter-number">{i+1}</span><span>{label}</span><i><b style={{width:`${seq.elapsed>=chapterTimes[i+1]||i===4&&seq.elapsed>=seq.duration?100:current===i?Math.min(100,(seq.elapsed-chapterTimes[i])/((chapterTimes[i+1]??seq.duration)-chapterTimes[i])*100):0}%`}}/></i></button>)}</div><button className="replay" aria-label="重播当前剧本" onClick={()=>seq.jump(0)}><RotateCcw size={17}/></button></div>
 <div className="demo-caption"><span>{seq.manual?DEMO_MANUAL_HINT:DEMO_AUTO_HINT}</span></div><div className="scenario-takeaway"><GitBranch size={15}/>{s.takeaway}<span className="mobile-hint">左右滑动查看分支 <ArrowRight size={13}/></span></div>{s.notice&&<p className="scenario-notice">{s.notice}</p>}{s.sources&&<div className="scenario-sources">资料来源：{s.sources.map(src=><a href={src.url} key={src.url} target="_blank" rel="noopener noreferrer">{src.label}<ChevronRight size={11}/></a>)}</div>}
 </div>
}
export default function HeroDemo(){const [tab,setTab]=useState('prd'),[learning,setLearning]=useState('ai');const active=scenarios.find(s=>s.id===(tab==='learning'?learning:tab))!;return <section id="experience" className="experience-section" aria-labelledby="experience-title"><div className="experience-intro"><h2 id="experience-title">你的问题，会往哪里走？</h2><p>选一件你正在做的事，看它如何展开。</p></div><Tabs value={tab} onValueChange={value=>setTab(String(value))} className="scenario-tabs"><TabsList className="scenario-tab-list">{[['prd','写 PRD'],['technical','技术方案'],['marketing','营销方案'],['research','深度调研'],['learning','专题学习']].map(([value,label])=><TabsTrigger value={value} key={value}>{label}</TabsTrigger>)}</TabsList>{tab==='learning'&&<div className="learning-switch" aria-label="选择学习专题">{[['ai','自学 AI'],['stocks','看懂上市公司']].map(([value,label])=><button key={value} aria-pressed={learning===value} onClick={()=>setLearning(value)}>{label}</button>)}</div>}<TabsContent value={tab} className="scenario-content"><DemoPlayer key={active.id} scenario={active}/></TabsContent></Tabs></section>}

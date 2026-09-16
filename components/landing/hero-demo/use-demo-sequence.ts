'use client';
import {useEffect,useRef,useState,type RefObject} from 'react';
import type {Scenario} from '@/constants/landing-demo';
export type DemoView={visible:number;texts:string[];ready:boolean[];overlay:'none'|'toolbar'|'question';overlayEpisode:number;source:number;popupQuestion:string;inherited:number;artifactReady:boolean;mentionOpen:boolean;referenceSelected:boolean;returned:boolean;mainDraft:string;cursor:{target:string|null;clicking:boolean}};
export function viewAt(s:Scenario,t:number):DemoView{
 const starts=[0,10000,21000],ends=[4700,15500,27500];
 const text=s.lanes.map((l,i)=>l.text.slice(0,Math.floor(l.text.length*Math.max(0,Math.min(1,(t-starts[i])/(ends[i]-starts[i]))))));
 const first=t>=5000&&t<10000,second=t>=16000&&t<21000;
 const source=second?1:0;const question=first&&t>=7000||second&&t>=18000;
 let target:string|null=null;
 if(first||second)target=question?'fork-submit':`anchor-${source}`;
 if(t>=28000&&t<30500)target='inherited-2';
 if(s.artifact&&t>=31000&&t<34000)target='artifact-create';
 if(s.artifact&&t>=34000&&t<36000)target='artifact-option';
 if(s.artifact&&t>=36000&&t<39000)target='main-send';
 return {visible:t<10000?1:t<21000?2:3,texts:text,ready:ends.map(e=>t>=e),overlay:first||second?(question?'question':'toolbar'):'none',overlayEpisode:first?1:second?2:0,source,popupQuestion:question?s.lanes[source+1].question.slice(0,Math.floor((t-(source===0?7000:18000))/1800*s.lanes[source+1].question.length)):'',inherited:t>=28000&&t<31000?2:-1,artifactReady:!!s.artifact&&t>=33000,mentionOpen:!!s.artifact&&t>=34000&&t<36000,referenceSelected:!!s.artifact&&t>=36000,returned:!!s.artifact&&t>=39000,mainDraft:s.artifact&&t>=34000&&t<36000?'@':s.artifact&&t>=36000&&t<39000?'根据这份结论，补充主线的实现步骤和验收标准。':'',cursor:{target,clicking:false}};
}
export function useDemoSequence(s:Scenario,root:RefObject<HTMLDivElement|null>){
 const duration=s.artifact?42000:32000;
 const [elapsed,setElapsed]=useState(0),[playing,setPlaying]=useState(false),[manual,setManual]=useState(false);
 const [override,setOverride]=useState<Partial<DemoView>>({}),[generation,setGeneration]=useState(0);
 /* 被用户关掉的脚本浮层按「第几段」记账：关掉第一段不会连带压掉第二段的浮层。 */
 const [dismissedEpisode,setDismissedEpisode]=useState(0);
 const touched=useRef(false),resume=useRef(false),playingRef=useRef(false);
 /* 播放控制读「最新已提交值」而非闭包快照：同一次点击里浮层可能先因点空白而关闭，
    若读旧值会把刚变化的播放状态再翻转一次，出现「说明已暂停但动画仍在走」的不一致。 */
 const latest=useRef({playing:false,elapsed:0,manual:false});
 useEffect(()=>{
   latest.current={playing,elapsed,manual};
   playingRef.current=playing;
 },[playing,elapsed,manual]);
 useEffect(()=>{
   const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
   const node=root.current;if(!node)return;
   const observer=new IntersectionObserver(([e])=>{if(e.isIntersecting&&!touched.current){touched.current=true;if(reduced)setElapsed(duration);else setPlaying(true)}},{threshold:.2});observer.observe(node);
   const visibility=()=>{if(document.hidden){resume.current=playingRef.current;setPlaying(false)}else if(resume.current){resume.current=false;setPlaying(true)}};
   document.addEventListener('visibilitychange',visibility);
   return()=>{observer.disconnect();document.removeEventListener('visibilitychange',visibility)};
 },[duration,root]);
 const finished=elapsed>=duration;
 useEffect(()=>{if(!playing||finished)return;const id=setInterval(()=>setElapsed(t=>Math.min(duration,t+100)),100);return()=>clearInterval(id)},[playing,duration,finished]);
 const base=viewAt(s,elapsed);
 /* 关掉浮层只是「收起这一段的浮层」，不算接管演示：不暂停、不置 manual。 */
 const dismissOverlay=()=>{setDismissedEpisode(current=>base.overlayEpisode||current)};
 const interact=(patch:Partial<DemoView>)=>{touched.current=true;resume.current=false;setPlaying(false);setManual(true);setOverride(v=>({...v,...patch,cursor:{target:null,clicking:false}}))};
 const jump=(t:number)=>{touched.current=true;resume.current=false;setDismissedEpisode(0);setOverride({});setManual(false);setGeneration(n=>n+1);setElapsed(t);setPlaying(true)};
 const toggle=()=>{touched.current=true;resume.current=false;
   const now=latest.current;
   if(now.manual||now.elapsed>=duration){jump(0);return}
   setPlaying(!now.playing)};
  /* overlay 解析顺序：本段浮层被关掉 → 关；用户手选的浮层 → 听用户的；否则跟随剧本。
     自动播放期间以剧本为准，避免上一次手选的浮层在播放推进后残留。 */
  const overlay:DemoView['overlay']=
    base.overlayEpisode>0&&dismissedEpisode===base.overlayEpisode
      ?'none'
      :playing&&!finished
        ?base.overlay
        :(override.overlay??base.overlay);
  return {view:{...base,...override,overlay},elapsed,duration,playing:playing&&!finished,manual,generation,interact,dismissOverlay,jump,toggle};
}

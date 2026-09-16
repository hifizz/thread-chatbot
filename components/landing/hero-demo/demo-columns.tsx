'use client';
/**
 * 演示列容器：顶栏（可操作子集）、列槽与折叠细条、列间分割线、划选工具条与提问气泡。
 *
 * 状态分层：
 * · 剧本时间线（useDemoSequence）负责自动播放（可见列、流式文本、脚本弹层）；
 * · 本组件的本地态负责用户手操作（列槽增删折叠、列宽、活跃序、划选）。
 * 播放只沿「补齐缺失列」的方向写入本地态（渲染期状态调整，与 selection-bubble 同款写法），
 * 因此用户折叠 / 收起的列不会被播放覆盖；任何手操作都会暂停播放（interact）。
 * 重播 / 重开演示由 generation 变化触发一次渲染期重置。
 */
import {useCallback,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ChevronsLeftRight,FileText,GitBranch} from 'lucide-react';
import type {Scenario} from '@/constants/landing-demo';
import {
DEMO_AUTO_COLS,DEMO_CANVAS_ONLY_COLUMNS,DEMO_CANVAS_VIEW,DEMO_COLUMNS_VIEW,DEMO_MODE_FOLD,DEMO_MODE_REPLACE,
DEMO_NEW_CHAT,DEMO_PROJECT,DEMO_RESIZER_LABEL,DEMO_THREAD_TREE,DEMO_TREE_LIST,
} from '@/constants/landing-hero';
import type {DemoView} from './use-demo-sequence';
import {maxExpandedFor,placeDemoSlot,trimDemoSlots,type DemoPlacementHint,type DemoPlacementMode,type DemoSlot} from './demo-placement';
import type {DemoLocalApi,DemoLocalState} from './use-demo-local-state';
import {DemoQuestionBubble,DemoSelectionToolbar} from './demo-selection';
import {ThreadPane,type DemoSelectionTarget} from './thread-pane';

const MIN_COL_WIDTH = 250;
const DEFAULT_COL_WIDTH = 340;
const FLASH_MS = 900;

function laneSlotId(laneIndex: number): string {
  return laneIndex === 0 ? 'main' : `lane-${laneIndex}`;
}
function laneIndexOf(slotId: string): number {
  return slotId === 'main' ? 0 : Number(slotId.split('-')[1]);
}

export function DemoColumns({
  scenario:s,view,interact,dismissOverlay,boundary,local,onResetDemo,selection,onSelection,bubble,onBubble,generation,
}:{
  scenario:Scenario;view:DemoView;interact:(p:Partial<DemoView>)=>void;dismissOverlay:()=>void;boundary:HTMLElement|null;
  local:{state:DemoLocalState;api:DemoLocalApi};onResetDemo:()=>void;
  selection:DemoSelectionTarget|null;onSelection:(target:DemoSelectionTarget|null)=>void;
  bubble:DemoSelectionTarget|null;onBubble:(target:DemoSelectionTarget|null)=>void;generation:number;
}){
  const [slots,setSlots]=useState<DemoSlot[]>([]);
  const [mode,setMode]=useState<DemoPlacementMode>('replace');
  const [forceCols,setForceCols]=useState<number|null>(null);
  const [widths,setWidths]=useState<Record<string,number>>({});
  const [flashId,setFlashId]=useState<string|null>(null);
  const [active,setActive]=useState<{seq:number;at:Record<string,number>}>({seq:0,at:{}});
  const [synced,setSynced]=useState({visible:0,generation});
  const flashTimer=useRef<number|null>(null);
  const maxExpanded=maxExpandedFor(forceCols);

  /* 渲染期状态调整：重播 / 重开演示清空本地列态（同款写法见 branching/selection/selection-bubble）。 */
  if(generation!==synced.generation){
    setSynced({visible:0,generation});
    setSlots([]);
    setWidths({});
    setFlashId(null);
    setActive({seq:0,at:{}});
  }else if(view.visible>synced.visible){
    /* 播放新露一列：补齐缺失的列槽，保留用户已折叠的槽，并把新列记为最近活跃。 */
    const revealed=laneSlotId(view.visible-1);
    setSynced(current=>({...current,visible:view.visible}));
    setSlots(previous=>{
      const needed:DemoSlot[]=[];
      for(let lane=1;lane<view.visible;lane++){
        const id=laneSlotId(lane);
        needed.push(previous.find(slot=>slot.id===id)??{id,folded:false});
      }
      const foldedExtras=previous.filter(slot=>slot.folded&&!needed.some(entry=>entry.id===slot.id));
      return [...needed,...foldedExtras];
    });
    setActive(previous=>({seq:previous.seq+1,at:{...previous.at,[revealed]:previous.seq+1}}));
  }

  const flash=useCallback((id:string)=>{
    setFlashId(id);
    if(flashTimer.current)window.clearTimeout(flashTimer.current);
    flashTimer.current=window.setTimeout(()=>setFlashId(current=>current===id?null:current),FLASH_MS);
  },[]);

  const touch=useCallback((id:string)=>{
    setActive(previous=>({seq:previous.seq+1,at:{...previous.at,[id]:previous.seq+1}}));
  },[]);
  const lastActiveOf=useCallback((id:string)=>active.at[id]??0,[active]);
  const titleOf=useCallback((id:string)=>s.lanes[laneIndexOf(id)].title,[s]);

  const revealLane=useCallback((laneIndex:number)=>{
    interact({visible:Math.max(view.visible,laneIndex+1),texts:s.lanes.map(lane=>lane.text),ready:[true,true,true],overlay:'none'});
    requestAnimationFrame(()=>document.getElementById(`thread-lane-${laneIndex}`)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'}));
  },[interact,s,view.visible]);

  const openLane=useCallback((laneIndex:number,sourceSlotId:string,hint?:DemoPlacementHint)=>{
    if(laneIndex===0){
      flash('main');
      return;
    }
    const targetId=laneSlotId(laneIndex);
    touch(targetId);
    setSlots(previous=>{
      const {slots:next,effect}=placeDemoSlot(mode,previous,targetId,{
        sourceId:sourceSlotId,maxExpanded,lastActiveOf,hint,
      });
      if(effect.kind!=='visible')flash(targetId);
      return next;
    });
    revealLane(laneIndex);
  },[flash,maxExpanded,mode,revealLane,touch,lastActiveOf]);

  const openById=useCallback((id:string,sourceId:string,keepSource?:boolean)=>{
    openLane(laneIndexOf(id),sourceId,keepSource?{keepSource:true}:undefined);
  },[openLane]);

  const fork=useCallback((laneIndex:number,hint?:DemoPlacementHint,question?:string)=>{
    const target=laneIndex+1;
    const targetId=laneSlotId(target);
    if(question?.trim())local.api.sendQuestion(target,question.trim());
    else local.api.setPrefill(target,`关于「${s.lanes[laneIndex].anchor??s.lanes[laneIndex].title}」，`);
    setSlots(previous=>{
      const withTarget=previous.some(slot=>slot.id===targetId)?previous:[...previous,{id:targetId,folded:false}];
      const {slots:next}=placeDemoSlot(mode,withTarget,targetId,{
        sourceId:laneSlotId(laneIndex),maxExpanded,lastActiveOf,hint,
      });
      return next;
    });
    touch(targetId);
    flash(targetId);
    revealLane(target);
  },[flash,lastActiveOf,local,maxExpanded,mode,revealLane,s,touch]);

  const collapse=useCallback((slotId:string)=>{
    interact({});
    setSlots(previous=>previous.map(slot=>slot.id===slotId?{...slot,folded:true}:slot));
  },[interact]);

  const expand=useCallback((slotId:string)=>{
    interact({});
    touch(slotId);
    setSlots(previous=>trimDemoSlots(previous.map(slot=>slot.id===slotId?{...slot,folded:false}:slot),maxExpanded));
    flash(slotId);
  },[flash,interact,maxExpanded,touch]);

  const crumb=useCallback((targetId:string)=>{
    expand(targetId);
    if(targetId!=='main')revealLane(laneIndexOf(targetId));
  },[expand,revealLane]);

  const switchLane=useCallback((slotId:string,laneIndex:number)=>{
    const nextId=laneSlotId(laneIndex);
    interact({visible:Math.max(view.visible,laneIndex+1),texts:s.lanes.map(lane=>lane.text),ready:[true,true,true],overlay:'none'});
    setSlots(previous=>{
      const swapped=previous.map(slot=>slot.id===slotId?{id:nextId,folded:false}:slot);
      const deduped=swapped.filter((slot,index)=>swapped.findIndex(other=>other.id===slot.id)===index);
      return trimDemoSlots(deduped,maxExpanded);
    });
    touch(nextId);
    flash(nextId);
  },[flash,interact,maxExpanded,s,touch,view.visible]);

  const resizeBy=useCallback((leftId:string,rightId:string,delta:number)=>{
    setWidths(previous=>{
      const left=(previous[leftId]??DEFAULT_COL_WIDTH)+delta;
      const right=(previous[rightId]??DEFAULT_COL_WIDTH)-delta;
      if(left<MIN_COL_WIDTH||right<MIN_COL_WIDTH)return previous;
      return {...previous,[leftId]:Math.round(left),[rightId]:Math.round(right)};
    });
  },[]);
  const resetWidths=useCallback((ids:string[])=>{
    setWidths(previous=>Object.fromEntries(Object.entries(previous).filter(([key])=>!ids.includes(key))));
  },[]);

  const visibleSlots=useMemo(()=>trimDemoSlots(slots,maxExpanded),[slots,maxExpanded]);
  const laneIndexes=useMemo(
    ()=>[0,...visibleSlots.map(slot=>laneIndexOf(slot.id))],
    [visibleSlots]
  );
  const branchCount=laneIndexes.length-1;
  const markdownCount=s.artifact?1:0;

  return <div className="landing-demo">
    <div className="topbar">
      <div className="top-left">
        <button type="button" className="top-btn" onClick={onResetDemo}>{DEMO_NEW_CHAT}</button>
        <button type="button" className="top-btn" onClick={()=>document.getElementById('experience')?.scrollIntoView({behavior:'smooth'})}>{DEMO_TREE_LIST}</button>
        <strong>Thread Chat</strong>
      </div>
      <div className="top-controls">
        <span className="segmented" role="group" aria-label="视图模式">
          <span className="active"><ChevronsLeftRight size={11}/>{DEMO_COLUMNS_VIEW}</span>
          <span className="demo-disabled" title={DEMO_CANVAS_ONLY_COLUMNS} aria-disabled="true">{DEMO_CANVAS_VIEW}</span>
        </span>
        <span className="segmented" role="group" aria-label="列数">
          {[null,2,3].map(value=><button key={String(value)} type="button"
            className={forceCols===value?'active':''} aria-pressed={forceCols===value}
            onClick={()=>setForceCols(value)}>{value===null?DEMO_AUTO_COLS:String(value)}</button>)}
        </span>
        <span className="segmented" role="group" aria-label="列满时的放置策略">
          <button type="button" className={mode==='replace'?'active':''} aria-pressed={mode==='replace'} onClick={()=>setMode('replace')}>{DEMO_MODE_REPLACE}</button>
          <button type="button" className={mode==='fold'?'active':''} aria-pressed={mode==='fold'} onClick={()=>setMode('fold')}>{DEMO_MODE_FOLD}</button>
        </span>
        <button type="button" className="top-btn" title="查看已打开的会话列"
          onClick={()=>document.getElementById('thread-lane-1')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'})}>
          <GitBranch size={11}/>{DEMO_THREAD_TREE} · {branchCount}
        </button>
        <button type="button" className="top-btn" title="演示中的 Artifact 产物">
          <FileText size={11}/>{DEMO_PROJECT} · {markdownCount}
        </button>
      </div>
    </div>

    <div className="cols">
      {[{id:'main',folded:false} as DemoSlot,...visibleSlots].map((slot,index,list)=>{
        const laneIndex=laneIndexOf(slot.id);
        if(slot.folded){
          return <button key={slot.id} type="button" className="col-strip"
            style={{'--demo-accent':laneIndex===2?'#7c62a8':'#2f7d6b'} as CSSProperties}
            title={`「${titleOf(slot.id)}」已折叠为细条 · 点击原地展开`}
            onClick={()=>expand(slot.id)}>
            <span className="fn">{laneIndex}</span>
            <span className="vt">{titleOf(slot.id)}</span>
          </button>;
        }
        const previous=list[index-1];
        const resizerLeft=previous&&!previous.folded?previous.id:null;
        return <span key={slot.id} className="demo-col-group">
          {resizerLeft&&<ColumnResizer leftId={resizerLeft} rightId={slot.id} onResize={resizeBy} onReset={()=>resetWidths([resizerLeft,slot.id])}/>}
          <span className="lane-slot" id={`thread-lane-${laneIndex}`}
            style={(widths[slot.id]?{flex:`1 1 ${widths[slot.id]}px`}:undefined) as CSSProperties}>
            <ThreadPane scenario={s} index={laneIndex} view={view} interact={interact} onDismissOverlay={dismissOverlay} onFork={fork}
              boundary={boundary} slotId={slot.id} onOpenLane={openById} onCollapse={collapse}
              onCrumb={crumb} onSwitch={switchLane} onSelectText={onSelection} local={local} flashId={flashId}/>
          </span>
        </span>;
      })}
    </div>

    {selection&&!bubble&&<DemoSelectionToolbar selection={selection} container={boundary}
      onClose={()=>onSelection(null)}
      onContinue={()=>{
        local.api.setQuote(selection.laneIndex,selection.text);
        touch(laneSlotId(selection.laneIndex));
        onSelection(null);
        interact({});
      }}
      onBranch={()=>{onBubble(selection);onSelection(null)}}/>}

    {bubble&&<DemoQuestionBubble selection={bubble} container={boundary} slots={visibleSlots} mode={mode}
      maxExpanded={maxExpanded} lastActiveOf={lastActiveOf} titleOf={titleOf}
      sourceId={laneSlotId(bubble.laneIndex)}
      onClose={()=>onBubble(null)}
      onSubmit={(question,hint)=>{fork(bubble.laneIndex,hint,question||undefined);onBubble(null)}}/>}
  </div>;
}

function ColumnResizer({
  leftId,rightId,onResize,onReset,
}:{
  leftId:string;rightId:string;
  onResize:(leftId:string,rightId:string,delta:number)=>void;onReset:()=>void;
}){
  const lastX=useRef<number|null>(null);
  return <div className="col-resizer" role="separator" aria-orientation="vertical"
    aria-label={DEMO_RESIZER_LABEL} title={DEMO_RESIZER_LABEL} tabIndex={0}
    onPointerDown={event=>{
      lastX.current=event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event=>{
      if(lastX.current===null)return;
      const delta=event.clientX-lastX.current;
      lastX.current=event.clientX;
      onResize(leftId,rightId,delta);
    }}
    onPointerUp={event=>{
      lastX.current=null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={()=>{lastX.current=null}}
    onDoubleClick={onReset}
    onKeyDown={event=>{
      if(event.key==='ArrowLeft'){event.preventDefault();onResize(leftId,rightId,-24)}
      if(event.key==='ArrowRight'){event.preventDefault();onResize(leftId,rightId,24)}
    }}/>;
}

'use client';
/**
 * 演示单列（主线 / 分支）：列头、讨论焦点与继承上文、消息流、消息工具条、Artifact 卡、composer。
 * 视觉与文案对齐真实工作台（app/thread-chat/branching/branchable-chat.tsx、
 * chat/message/conversation-message.tsx、orchestration/artifacts/*），但只操作本地演示态。
 */
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {ArrowDown,AtSign,Check,Copy,FileText,GitBranch,ListTree,MessageSquareReply,Pencil,X} from 'lucide-react';
import {Popover} from '@base-ui/react/popover';
import type {Scenario} from '@/constants/landing-demo';
import {
DEMO_ANCHOR_TAG,DEMO_ARTIFACT,DEMO_COL_TITLE_MAIN,DEMO_CRUMB_ROOT,DEMO_EDIT_ONLY_LATEST,DEMO_FOCUS_LABEL,DEMO_INHERITED_LABEL,
DEMO_LOCAL_REPLY,DEMO_SCROLL_END_LABEL,DEMO_SUBTREE_LABEL,DEMO_SWITCH_LABEL,DEMO_USER_MESSAGE_COLLAPSED_LINES,
DEMO_WHO_AI,DEMO_WHO_YOU,
} from '@/constants/landing-hero';
import type {DemoView} from './use-demo-sequence';
import type {DemoLocalApi,DemoLocalState} from './use-demo-local-state';
import type {DemoPlacementHint} from './demo-placement';
import {DemoPopoverContent} from './demo-popover-content';
import {DemoArtifactCard,DemoArtifactProgressCard} from './demo-artifact-card';
import {DemoMessageToolbar} from './demo-message-actions';
import {DemoComposer} from './demo-composer';

const INHERITED_TRUNCATE = 130;
const USER_CLAMP_THRESHOLD = 96;
const LANE_BRANCH_ACCENT = '#7c62a8';
const LANE_MAIN_ACCENT = '#2f7d6b';

export interface DemoSelectionTarget {
  laneIndex: number;
  text: string;
  rect: {left:number;top:number;width:number;height:number};
}

export interface ThreadPaneProps {
  scenario: Scenario;
  index: number;
  view: DemoView;
  interact: (patch: Partial<DemoView>) => void;
  onDismissOverlay: () => void;
  onFork: (laneIndex: number, hint?: DemoPlacementHint, question?: string) => void;
  boundary: HTMLElement | null;
  slotId: string;
  onOpenLane: (id: string, sourceId: string, keepSource?: boolean) => void;
  onCollapse: (slotId: string) => void;
  onCrumb: (slotId: string) => void;
  onSwitch: (slotId: string, target: number) => void;
  onSelectText: (target: DemoSelectionTarget) => void;
  local: {state: DemoLocalState; api: DemoLocalApi};
  flashId: string | null;
}

function assistantCopyText(s: Scenario, index: number, extras: string[]): string {
  const lane = s.lanes[index];
  return [lane.question, lane.text, lane.heading, ...(lane.bullets ?? []),
    ...(lane.rows?.map(row => row.join('：')) ?? []), lane.anchor ?? '', ...extras].join('\n');
}

/** 助手正文：原生划选只由这里的 mouseup 触发（工具条 / 输入框的选区不参与）。
    streaming 同时覆盖剧本流式与本列重生成/追问产生的流式（后者由本地态驱动）。 */
function AssistantProse({
  scenario:s,index:i,view:v,streaming,onSelectText,
}:{
  scenario:Scenario;index:number;view:DemoView;streaming:boolean;
  onSelectText:(text:string,rect:{left:number;top:number;width:number;height:number})=>void;
}){
  const lane=s.lanes[i];
  const host=useRef<HTMLDivElement>(null);
  const handleMouseUp=useCallback(()=>{
    const selection=window.getSelection();
    if(!selection||selection.isCollapsed||selection.rangeCount===0)return;
    const range=selection.getRangeAt(0);
    const node=host.current;
    if(!node||!node.contains(range.commonAncestorContainer))return;
    const text=selection.toString().trim();
    if(!text)return;
    const rect=range.getBoundingClientRect();
    if(rect.width===0&&rect.height===0)return;
    onSelectText(text,{left:rect.left,top:rect.top,width:rect.width,height:rect.height});
  },[onSelectText]);
  return <div ref={host} className="demo-assistant-prose" onMouseUp={handleMouseUp}>
    <p>{v.texts[i]}{!v.ready[i]&&v.texts[i].length===0
      ?<span className="demo-typing" role="status" aria-label="正在生成回复"><i/><i/><i/></span>
      :!v.ready[i]||streaming?<span className="stream-caret"/>:null}</p>
    {v.ready[i]&&<>
      <h3>{lane.heading}</h3>
      {lane.bullets&&<ol>{lane.bullets.map(b=><li key={b}>{b}</li>)}</ol>}
      {lane.rows&&<div className="table-scroll"><table>
        <thead><tr><th>{i===2?'检查项':'关注点'}</th><th>说明</th></tr></thead>
        <tbody>{lane.rows.map(([a,b])=><tr key={a}><td>{a}</td><td>{b}</td></tr>)}</tbody>
      </table></div>}
    </>}
  </div>;
}

/** 锚点句 + 脚注上标 + 划选浮层（在当前对话问 / 此处提问）。 */
function AnchorBlock({
  scenario:s,index:i,view:v,interact,onDismissOverlay,onFork,boundary,slotId,onOpenLane,
}:{
  scenario:Scenario;index:number;view:DemoView;interact:(p:Partial<DemoView>)=>void;
  onDismissOverlay:()=>void;
  onFork:(laneIndex:number)=>void;boundary:HTMLElement|null;slotId:string;
  onOpenLane:(id:string,sourceId:string,keepSource?:boolean)=>void;
}){
  const lane=s.lanes[i];
  const anchorRef=useRef<HTMLButtonElement>(null);
  if(!lane.anchor)return null;
  const selected=v.source===i&&v.overlay!=='none';
  return <Popover.Root open={selected} onOpenChange={open=>{if(!open&&selected)onDismissOverlay()}}>
    <div className="anchor-wrap">
      <button ref={anchorRef} className="source-anchor"
        style={{'--selection-width':selected?'100%':'0%'} as CSSProperties}
        data-cursor-target={`anchor-${i}`}
        onClick={()=>interact({overlay:'toolbar',source:i})}>{lane.anchor}</button>
      {v.visible>i+1&&<button className="footnote" data-cursor-target={`footnote-${i}`} aria-label={`查看分支 ${i+1}`}
        onClick={event=>onOpenLane(`lane-${i+1}`,slotId,event.metaKey||event.ctrlKey)}>{i+1}</button>}
    </div>
    <DemoPopoverContent anchor={anchorRef} boundary={boundary}
      className={`landing-demo-popover ${v.overlay==='question'?'question-surface':'toolbar-surface'}`}
      side="bottom" align="center" sideOffset={9}>
      {v.overlay==='toolbar'
        ?<>
          <button data-cursor-target="demo-continue" onClick={()=>interact({overlay:'none',mainDraft:`关于「${lane.anchor}」，`})}>
            <MessageSquareReply size={17}/>在当前对话问
          </button>
          <button data-cursor-target="fork-open" onClick={()=>interact({overlay:'question',popupQuestion:s.lanes[i+1]?.question??''})}>
            <GitBranch size={17}/>此处提问
          </button>
        </>
        :<>
          <div className="lbl">从这句话开启分支<button type="button" aria-label="关闭提问" onClick={onDismissOverlay}><X size={15}/></button></div>
          <div className="quote">{lane.anchor}</div>
          <textarea aria-label="分支问题" value={v.popupQuestion} onChange={event=>interact({popupQuestion:event.target.value})}/>
          <button className="fork-submit" data-cursor-target="fork-submit" disabled={!v.popupQuestion.trim()} onClick={()=>onFork(i)}>
            <GitBranch size={15}/>在右侧创建分支
          </button>
          <div className="placement-preview"><small>自动带上已有背景，无需重新解释</small></div>
        </>}
    </DemoPopoverContent>
  </Popover.Root>;
}

/** 用户消息工具条：复制 + 仅最新可编辑。 */
function UserToolbar({laneTitle,text,editable}:{laneTitle:string;text:string;editable:boolean}){
  const [copied,setCopied]=useState(false);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState(text);
  const copy=async()=>{
    try{await navigator.clipboard.writeText(text);setCopied(true);window.setTimeout(()=>setCopied(false),1600)}
    catch{setCopied(false)}
  };
  if(editing)return <div className="demo-user-edit">
    <textarea aria-label={`编辑 ${laneTitle} 的问题`} value={draft} onChange={event=>setDraft(event.target.value)}/>
    <div className="demo-user-edit-actions">
      <button type="button" onClick={()=>{setEditing(false);setDraft(text)}}>取消</button>
      <button type="button" className="demo-primary" disabled={!draft.trim()} onClick={()=>setEditing(false)}>发送</button>
    </div>
  </div>;
  return <div className="demo-message-toolbar demo-end" role="toolbar" aria-label={`消息操作 · ${laneTitle}`}>
    <button type="button" className="demo-message-action" aria-label={copied?'已复制':'复制'} title={copied?'已复制':'复制'} onClick={()=>void copy()}>
      {copied?<Check size={14}/>:<Copy size={14}/>}
    </button>
    <button type="button" className="demo-message-action" aria-label="重新编辑" title={editable?'重新编辑':DEMO_EDIT_ONLY_LATEST}
      disabled={!editable} onClick={()=>{setDraft(text);setEditing(true)}}><Pencil size={14}/></button>
  </div>;
}

export function ThreadPane(props:ThreadPaneProps){
  const {scenario:s,index:i,view:v,interact,onDismissOverlay,onFork,boundary,slotId,onOpenLane,onCollapse,onCrumb,onSwitch,onSelectText,local,flashId}=props;
  const lane=s.lanes[i];
  const list=useRef<HTMLDivElement>(null);
  const [artifactExpanded,setArtifactExpanded]=useState(false);
  const [atEnd,setAtEnd]=useState(true);
  const [subtreeOpen,setSubtreeOpen]=useState(false);
  const [switchOpen,setSwitchOpen]=useState(false);
  const [userExpanded,setUserExpanded]=useState(false);
  const accent=i===2?LANE_BRANCH_ACCENT:LANE_MAIN_ACCENT;
  const laneState=local.state.lanes[i];
  const childCount=Math.max(0,s.lanes.length-i-1);
  const latestAssistant=v.ready[i];
  const extraCount=laneState.extraQuestions.length;
  const streamedText=v.texts[i];

  /* 滚动跟随：与工作台一致——只有用户本来就在底部附近时才自动贴底，
     上滑释放后不再抢滚动（stickRef 只记录位置，不参与渲染）。 */
  const stick=useRef(true);
  useEffect(()=>{
    const scroller=list.current;
    if(stick.current&&scroller)scroller.scrollTop=scroller.scrollHeight;
  },[v.returned,i,streamedText,latestAssistant,extraCount,laneState.streaming]);
  useEffect(()=>{
    const node=list.current;
    if(!node)return;
    const onScroll=()=>{
      const nearEnd=node.scrollHeight-node.scrollTop-node.clientHeight<24;
      stick.current=nearEnd;
      setAtEnd(nearEnd);
    };
    onScroll();
    node.addEventListener('scroll',onScroll,{passive:true});
    return ()=>node.removeEventListener('scroll',onScroll);
  },[]);

  const selectText=useCallback((text:string,rect:{left:number;top:number;width:number;height:number})=>{
    interact({});
    onSelectText({laneIndex:i,text,rect});
  },[i,interact,onSelectText]);
  const userLong=lane.question.length>USER_CLAMP_THRESHOLD;
  const copyText=assistantCopyText(s,i,laneState.extraQuestions);
  const flash=flashId===slotId;
  const inheritedRows=s.lanes.slice(0,i);

  return <article className={`column ${i?'branch':''}${flash?' demo-flash':''}`}
    style={{'--demo-accent':accent} as CSSProperties}
    aria-label={`${i?'分支 '+i:'主线'}：${lane.title}`} data-thread-id={slotId}>
    <header className="col-head"><div className="lane">
      {i>0&&<div className="crumb">
        {Array.from({length:i+1}).map((_,depth)=>{
          const here=depth===i;
          const target=depth===0?'main':`lane-${depth}`;
          const label=depth===0?DEMO_CRUMB_ROOT:s.lanes[depth].title;
          return <span key={target} className="demo-crumb-seg">
            {depth>0&&<span className="chev">›</span>}
            {here
              ?<span className="here">{lane.title}</span>
              :<button type="button" className="demo-crumb-btn" title={`回到「${label}」`} onClick={()=>onCrumb(target)}>{label}</button>}
          </span>;
        })}
      </div>}
      <div className="ctitle-row">
        <span className={i?'depth-badge':'anchor-tag'}>{i?`L${i}`:DEMO_ANCHOR_TAG}</span>
        <strong className="ctitle">{i?lane.title:DEMO_COL_TITLE_MAIN}</strong>
        <span className="cactions">
          <span className="demo-mini-wrap">
            <button type="button" className="cbtn tree" data-cursor-target={`subtree-${i}`}
              title={`${DEMO_SUBTREE_LABEL}（${childCount}）`} aria-label={`${DEMO_SUBTREE_LABEL}（${childCount}）`}
              aria-expanded={subtreeOpen} onClick={()=>setSubtreeOpen(open=>!open)}>
              <ListTree size={12}/><span className="n">{childCount}</span>
            </button>
            {subtreeOpen&&<span className="demo-mini-panel" role="menu" aria-label={DEMO_SUBTREE_LABEL}>
              {s.lanes.map((row,rowIndex)=>rowIndex>i
                ?<button key={row.title} type="button" role="menuitem"
                  onClick={()=>{setSubtreeOpen(false);onOpenLane(`lane-${rowIndex}`,slotId)}}>{row.title}</button>
                :null)}
              {childCount===0&&<span className="demo-mini-empty">暂无子分支</span>}
            </span>}
          </span>
          {i>0&&<span className="demo-mini-wrap">
            <button type="button" className="cbtn" data-cursor-target={`switch-${i}`} title="把本列切换为任意会话"
              aria-expanded={switchOpen} onClick={()=>setSwitchOpen(open=>!open)}>{DEMO_SWITCH_LABEL}</button>
            {switchOpen&&<span className="demo-mini-panel" role="menu" aria-label="切换会话">
              {s.lanes.map((row,rowIndex)=><button key={row.title} type="button" role="menuitem" aria-current={rowIndex===i}
                onClick={()=>{setSwitchOpen(false);onSwitch(slotId,rowIndex)}}>{row.title}</button>)}
            </span>}
          </span>}
          {i>0&&<button type="button" className="cbtn" onClick={()=>onCollapse(slotId)}>收起</button>}
        </span>
      </div>
      {i===0&&<div className="col-sub">{lane.title}</div>}
    </div></header>

    {i>0&&<div className="context-fixed"><div className="lane">
      <div className="focus-banner">
        <span className="fn">{i}</span>
        <div className="ft">
          <span className="lbl">{DEMO_FOCUS_LABEL} · 划选自「{s.lanes[i-1].title}」</span>
          <q>{s.lanes[i-1].anchor}</q>
        </div>
      </div>
      <details className="inherited" open={v.inherited===i}>
        <summary data-cursor-target={`inherited-${i}`}
          onClick={event=>{event.preventDefault();interact({inherited:v.inherited===i?-1:i})}}>
          <span className="tw">{v.inherited===i?'▾':'▸'}</span>{DEMO_INHERITED_LABEL} · {i*2} 条
        </summary>
        <div className="inherited-body">
          {inheritedRows.map(row=><div key={row.title} className="demo-inh-msg">
            <span className="who">{DEMO_WHO_YOU}</span>{row.question.length>INHERITED_TRUNCATE?`${row.question.slice(0,INHERITED_TRUNCATE)}…`:row.question}
            <br/>
            <span className="who">{DEMO_WHO_AI}</span>{row.text.length>INHERITED_TRUNCATE?`${row.text.slice(0,INHERITED_TRUNCATE)}…`:row.text}
          </div>)}
        </div>
      </details>
    </div></div>}

    <div className="msg-scroll-root">
      <div className="message-list" ref={list}><div className="lane">
        <div className="demo-message demo-user">
          <div className="who">{DEMO_WHO_YOU}</div>
          <div className="user-message">
            <div className={userExpanded?'':'demo-user-clamp'}
              style={{'--demo-user-lines':DEMO_USER_MESSAGE_COLLAPSED_LINES} as CSSProperties}>{lane.question}</div>
            {userLong&&<button type="button" className="demo-user-toggle" onClick={()=>setUserExpanded(open=>!open)}>{userExpanded?'收起':'展开'}</button>}
          </div>
          <UserToolbar laneTitle={lane.title} text={lane.question} editable={i===0}/>
        </div>

        <div className="demo-message demo-assistant">
          <div className="who">{DEMO_WHO_AI}</div>
          <div className="assistant-message">
            <AssistantProse scenario={s} index={i} view={v} streaming={laneState.streaming} onSelectText={selectText}/>
            {latestAssistant&&<AnchorBlock scenario={s} index={i} view={v} interact={interact} onDismissOverlay={onDismissOverlay} onFork={onFork} boundary={boundary} slotId={slotId} onOpenLane={onOpenLane}/>}
            {lane.note&&<p className="lane-note">{lane.note}</p>}
            {s.artifact&&i===2&&<div className="artifact-block">
              {!v.artifactReady
                ?<button type="button" className="create-artifact" data-cursor-target="artifact-create" onClick={()=>interact({artifactReady:true})}>
                  <FileText size={16}/>整理为 Artifact
                </button>
                :(v.mentionOpen||v.referenceSelected||v.returned)
                  ?<DemoArtifactCard accent={accent} expanded={artifactExpanded} onOpen={()=>setArtifactExpanded(open=>!open)}/>
                  :<DemoArtifactProgressCard accent={accent}/>}
            </div>}
          </div>
          <DemoMessageToolbar laneTitle={lane.title} text={copyText} regeneratable={latestAssistant}
            feedback={laneState.feedback}
            onFeedback={feedback=>local.api.setFeedback(i,feedback)}
            onRegenerate={()=>local.api.replayLane(i)}/>
        </div>

        {laneState.extraQuestions.map((question,questionIndex)=><div key={`extra-${i}-${questionIndex}`} className="demo-message demo-user">
          <div className="who">{DEMO_WHO_YOU}</div>
          <div className="user-message">{question}</div>
        </div>)}
        {extraCount>0&&<div className="demo-message demo-assistant">
          <div className="who">{DEMO_WHO_AI}</div>
          <div className="assistant-message"><p>
            {laneState.streaming
              ?'正在结合本列已有背景整理回答…'
              :`已结合本列已有背景回答：${laneState.extraQuestions[extraCount-1]}`}
            {laneState.streaming&&<span className="stream-caret"/>}
          </p></div>
        </div>}

        {v.returned&&i===0&&<div className="returned-block">
          <div className="user-message"><span className="reference-inline"><AtSign size={13}/>{DEMO_ARTIFACT.title}</span>根据这份结论，补充主线的实现步骤和验收标准。</div>
          <div className="assistant-message">
            <p>已结合你主动引用的分支结论，将方案收敛为三步：</p>
            <ol><li>输入 @，检索有权限访问的 Artifact。</li><li>选中后插入引用胶囊，并保留来源。</li><li>发送时校验权限，按上下文去重。</li></ol>
            <h3>验收标准</h3>
            <p>引用可移除、来源可追溯；未引用的分支细节不进入主线。</p>
          </div>
        </div>}

        {i>0&&laneState.quote!==null&&extraCount===0&&<div className="local-reply" role="status">{DEMO_LOCAL_REPLY}</div>}
      </div></div>
      {!atEnd&&<button type="button" className="demo-scroll-end" aria-label={DEMO_SCROLL_END_LABEL}
        onClick={()=>{
          const scroller=list.current;
          if(scroller)scroller.scrollTop=scroller.scrollHeight;
        }}><ArrowDown size={15}/></button>}
    </div>

    <DemoComposer scenario={s} index={i} view={v} interact={interact} boundary={boundary} local={local}/>
  </article>;
}

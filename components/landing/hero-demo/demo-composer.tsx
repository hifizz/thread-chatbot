'use client';
/**
 * 演示输入框：按真实工作台 composer 摆出元素（附件 / 模型 / 参数 / 语音占位 / 发送-停止），
 * 但全部只操作本地演示态——不调模型、不建会话、不写库。@ 引用沿用 Command + Popover。
 */
import {useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {ArrowUp,ChevronDown,CornerDownLeft,FileText,Mic,Paperclip,SlidersHorizontal,X} from 'lucide-react';
import {Popover} from '@base-ui/react/popover';
import {Command,CommandItem,CommandList} from '@/components/ui/command';
import {COMPOSER_ATTACHMENT_COPY} from '@/constants/attachment';
import {COMPOSER_MODEL_COPY} from '@/constants/composer-model';
import {THREAD_CHAT_MODEL_OPTIONS} from '@/constants/models';
import {
DEMO_ARTIFACT,DEMO_COMPOSER_PLACEHOLDER,DEMO_MODEL_FALLBACK_NAME,DEMO_MODEL_LOCKED_REASON,DEMO_VOICE_TITLE,
} from '@/constants/landing-hero';
import type {Scenario} from '@/constants/landing-demo';
import {DemoPopoverContent} from './demo-popover-content';
import type {DemoView} from './use-demo-sequence';
import type {DemoLocalApi,DemoLocalState} from './use-demo-local-state';

const VISIBLE_MODEL_COUNT = 8;

export function DemoComposer({
  scenario:s,index:i,view:v,interact,boundary,local,
}:{
  scenario:Scenario;index:number;view:DemoView;interact:(p:Partial<DemoView>)=>void;
  boundary:HTMLElement|null;local:{state:DemoLocalState;api:DemoLocalApi};
}){
  const lane=local.state.lanes[i];
  const composerRef=useRef<HTMLDivElement>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const [draft,setDraft]=useState('');
  const [appliedPrefill,setAppliedPrefill]=useState<string|null>(null);
  const [attachments,setAttachments]=useState<string[]>([]);
  const [paramsOpen,setParamsOpen]=useState(false);
  const [modelOpen,setModelOpen]=useState(false);

  // 代拟首问进入草稿（渲染期状态调整）：剧本给的 kickoff 可改写或直接回车确认。
  if(lane.prefill&&lane.prefill!==appliedPrefill){
    setAppliedPrefill(lane.prefill);
    setDraft(lane.prefill);
  }

  const streaming=lane.streaming;
  const modelName=useMemo(
    ()=>THREAD_CHAT_MODEL_OPTIONS.find(m=>m.id===local.state.modelId)?.name??DEMO_MODEL_FALLBACK_NAME,
    [local.state.modelId]
  );
  // 主线草稿归剧本时间线（播放时能看到逐字输入），分支草稿归本地态。
  const input=i===0?v.mainDraft:draft;

  const submit=()=>{
    const question=input.trim();
    if(!question&&!(i===0&&v.referenceSelected))return;
    if(i===0&&v.referenceSelected){
      interact({returned:true,mainDraft:'',mentionOpen:false});
      return;
    }
    local.api.sendQuestion(i,question||'继续追问');
    if(i>0)setDraft('');
    local.api.setPrefill(i,null);
    local.api.setQuote(i,null);
    interact({mainDraft:i===0?'':v.mainDraft});
  };

  const onKey=(e:ReactKeyboardEvent<HTMLTextAreaElement>)=>{
    if(e.nativeEvent.isComposing)return;
    if(i===0&&v.mentionOpen&&e.key==='Enter'){
      e.preventDefault();
      interact({referenceSelected:true,mentionOpen:false,mainDraft:v.mainDraft.replace(/@$/,'')});
      return;
    }
    if(e.key==='Escape'&&v.mentionOpen){
      e.preventDefault();
      interact({mentionOpen:false});
      return;
    }
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      submit();
    }
  };

  return <div className="composer">
    <Popover.Root open={i===0&&v.mentionOpen} onOpenChange={open=>{if(i===0&&!open)interact({mentionOpen:false})}}>
      <div ref={composerRef} className={`composer-inner${i>0?' branch':''}`}>
        {lane.quote&&<div className="demo-quote-bar">
          <span>引用：{lane.quote.length>42?`${lane.quote.slice(0,42)}…`:lane.quote}</span>
          <button type="button" aria-label="移除引用" onClick={()=>local.api.setQuote(i,null)}><X size={12}/></button>
        </div>}
        {i===0&&v.referenceSelected&&!v.returned&&<span className="reference-capsule" contentEditable={false}>
          <FileText size={13}/>{DEMO_ARTIFACT.title}
          <button type="button" aria-label="移除引用" onClick={()=>interact({referenceSelected:false})}><X size={12}/></button>
        </span>}
        {attachments.length>0&&<div className="demo-attach-tray" aria-label={COMPOSER_ATTACHMENT_COPY.tray}>
          {attachments.map(name=><span key={name} className="demo-attach-chip">
            <FileText size={12}/>{name}
            <button type="button" aria-label={`${COMPOSER_ATTACHMENT_COPY.remove} ${name}`} onClick={()=>setAttachments(list=>list.filter(x=>x!==name))}><X size={11}/></button>
          </span>)}
        </div>}
        <textarea
          data-cursor-target={i===0?'main-input':`input-${i}`}
          aria-label={i===0?'在主线继续提问':`在分支 ${i} 继续提问`}
          placeholder={i===0?(v.artifactReady?'输入 @ 引用分支结论…':DEMO_COMPOSER_PLACEHOLDER):'在这个分支里追问…'}
          value={input}
          onChange={e=>{
            const value=e.target.value;
            if(i===0)interact({mainDraft:value,mentionOpen:Boolean(s.artifact)&&v.artifactReady&&value.endsWith('@')});
            else setDraft(value);
          }}
          onKeyDown={onKey}
        />
        <div className="composer-toolbar">
          <span className="composer-actions">
            <input ref={fileRef} type="file" className="demo-file-hidden" aria-label={COMPOSER_ATTACHMENT_COPY.add} multiple
              onChange={e=>{
                const names=Array.from(e.target.files??[]).map(f=>f.name).filter(Boolean);
                if(names.length)setAttachments(list=>[...list,...names].slice(0,5));
                e.target.value='';
              }}/>
            <button type="button" className="demo-icon-btn" title={COMPOSER_ATTACHMENT_COPY.add} aria-label={COMPOSER_ATTACHMENT_COPY.add} onClick={()=>fileRef.current?.click()}><Paperclip size={14}/></button>
            <Popover.Root open={modelOpen} onOpenChange={setModelOpen}>
              <Popover.Trigger className={`demo-model-trigger${i>0?' demo-locked':''}`} disabled={i>0}
                aria-label={COMPOSER_MODEL_COPY.choose} title={i>0?DEMO_MODEL_LOCKED_REASON:COMPOSER_MODEL_COPY.choose}>
                <span className="demo-model-name">{modelName}</span><ChevronDown size={11}/>
              </Popover.Trigger>
              <DemoPopoverContent anchor={composerRef} boundary={boundary} className="landing-demo-popover demo-model-menu" side="top" align="start">
                {i===0
                  ?<div role="menu" aria-label={COMPOSER_MODEL_COPY.choose}>
                    {THREAD_CHAT_MODEL_OPTIONS.slice(0,VISIBLE_MODEL_COUNT).map(m=><button key={m.id} type="button" role="menuitemradio"
                      aria-checked={m.id===local.state.modelId} className={`demo-model-item${m.id===local.state.modelId?' demo-active':''}`}
                      onClick={()=>{local.api.setModel(m.id);setModelOpen(false)}}>
                      <span>{m.name}</span>{m.contextLabel?<small>{m.contextLabel}</small>:null}
                    </button>)}
                  </div>
                  :<div className="demo-locked-note">{DEMO_MODEL_LOCKED_REASON}</div>}
              </DemoPopoverContent>
            </Popover.Root>
            <button type="button" className="demo-icon-btn" title="生成参数" aria-label="生成参数" aria-expanded={paramsOpen} onClick={()=>setParamsOpen(o=>!o)}><SlidersHorizontal size={14}/></button>
            <button type="button" className="demo-icon-btn demo-disabled" title={DEMO_VOICE_TITLE} aria-label="语音输入" disabled><Mic size={14}/></button>
          </span>
          <button type="button" className="send-button" data-cursor-target={i===0?'main-send':`send-${i}`}
            aria-label={streaming?'停止生成':'发送问题'} title={streaming?'停止生成':'发送问题'}
            disabled={!streaming&&!input.trim()&&!(i===0&&v.referenceSelected)}
            onClick={()=>{if(streaming)local.api.finishStream(i);else submit()}}>
            {streaming?<X size={15}/>:<ArrowUp size={15}/>}
          </button>
        </div>
        {paramsOpen&&<div className="demo-params-note">演示参数面板：当前为默认配置，调整不影响演示回答。</div>}
      </div>
      <DemoPopoverContent anchor={composerRef} boundary={boundary} className="landing-demo-popover mention-surface" side="top" align="start">
        <Command>
          <div className="mention-label">引用分支产物 · 按 Enter 选择</div>
          <CommandList>
            <CommandItem value={DEMO_ARTIFACT.title} data-cursor-target="artifact-option"
              onSelect={()=>interact({referenceSelected:true,mentionOpen:false,mainDraft:v.mainDraft.replace(/@$/,'')})}>
              <FileText size={17}/>
              <span>{DEMO_ARTIFACT.title}<small>{DEMO_ARTIFACT.sourceLabel}</small></span>
              <CornerDownLeft size={13}/>
            </CommandItem>
          </CommandList>
        </Command>
      </DemoPopoverContent>
    </Popover.Root>
  </div>;
}

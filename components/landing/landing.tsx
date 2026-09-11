'use client';
import {GitBranch,ArrowUpRight,Quote,Columns3,AtSign} from 'lucide-react';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import HeroDemo from './hero-demo/hero-demo';
import Link from 'next/link';
import {ROUTES} from '@/constants/routes';
import {PROJECT} from '@/constants/project';
import {LandingEntry} from './landing-entry';
import {LANDING_FEATURES,LANDING_FAQS} from '@/constants/landing';
const featureIcons: Record<string, typeof Quote> = {quote:Quote,columns:Columns3,branch:GitBranch,reference:AtSign};
export default function Landing(){return <div className="threadchat-landing" lang="zh-CN"><main className="landing">
 <nav className="site-nav" aria-label="主导航"><a className="wordmark" href="#"><span className="brand-icon"><GitBranch size={20}/></span>ThreadChat</a><div className="nav-links"><a href="#experience">使用场景</a><a href="#faq">常见问题</a><Link className="nav-cta" href={ROUTES.startChat} prefetch={false}>开始使用<ArrowUpRight size={14}/></Link></div></nav>
 <section className="intro" id="signup"><h1 className="product-title">一款<span>能开分叉</span>的 AI</h1><p>做调研、写方案、学知识，总有值得继续追问的地方。从一句话开启分支，带着已有背景深入讨论；主线与分支并排阅读，需要时，再把结论带回来。</p><LandingEntry/></section>
 <HeroDemo/>
 <section className="value-section" aria-labelledby="value-title"><div className="section-heading"><h2 id="value-title">分栏展开讨论，<br/><span>分支树帮你找回每一个问题。</span></h2><p>从追问细节、对照依据，<br/>到带着结论继续推进任务。</p></div><div className="feature-grid">{LANDING_FEATURES.map((f,i)=>{const Icon=featureIcons[f.icon];return <article className="feature" key={f.title}><div className="feature-top"><Icon size={22}/><span>{String(i+1).padStart(2,'0')}</span></div><h3>{f.title}</h3><p>{f.text}</p><div className="feature-sample">{f.sample}</div></article>})}</div></section>
 <section className="faq-section" id="faq"><div><h2>你可能还想问</h2><p>在开始之前，<br/>先把这些小问题问清楚。</p></div><Accordion className="faq-list">{LANDING_FAQS.map(([q,a],i)=><AccordionItem key={q} value={String(i)}><AccordionTrigger>{q}</AccordionTrigger><AccordionContent>{a}</AccordionContent></AccordionItem>)}</Accordion></section>
 <section className="closing"><GitBranch size={32}/><h2>带一个正在做的问题，来试试。</h2><p>一份还没想清楚的需求，一个需要比较的方案，<br/>或者一个一直没弄懂的概念。</p><p className="closing-last">从这里开始，顺着它继续问。</p><LandingEntry/></section>
 <footer><a href="#" className="footer-brand">ThreadChat</a><span>一个问题，展开多种可能。</span><nav className="legal-links" aria-label="页脚导航"><Link href="/privacy">隐私政策</Link><Link href="/terms">服务条款</Link></nav><span>© {PROJECT.copyrightYear} {PROJECT.copyrightHolder}</span></footer>
 </main></div>}

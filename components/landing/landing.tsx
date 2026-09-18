'use client';
import {GitBranch,ArrowUpRight,Quote,Columns3,AtSign} from 'lucide-react';
import {Accordion,AccordionItem,AccordionTrigger,AccordionContent} from '@/components/ui/accordion';
import HeroDemo from './hero-demo/hero-demo';
import Link from 'next/link';
import {ROUTES} from '@/constants/routes';
import {PROJECT} from '@/constants/project';
import {LandingEntry} from './landing-entry';
import {LANDING_FEATURES,LANDING_FAQS} from '@/constants/landing';
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { PrivacySettingsButton } from "@/components/privacy/consent-controls"
import type { MessageKey } from "@/lib/i18n/dictionary"
import { useI18n } from "@/lib/i18n/client"

const featureIcons: Record<string, typeof Quote> = {quote:Quote,columns:Columns3,branch:GitBranch,reference:AtSign};
export default function Landing(){
  const { locale, t } = useI18n()
return <div className="threadchat-landing" lang={locale}><main className="landing">
 <nav className="site-nav" aria-label={t("landing.nav")}><a className="wordmark" href="#"><span className="brand-icon"><GitBranch size={20}/></span>ThreadChat</a><div className="nav-links"><LanguageSwitcher/><a href="#experience">{t("landing.scenarios")}</a><a href="#faq">{t("landing.faq")}</a><Link className="nav-cta" href={ROUTES.startChat} prefetch={false}>{t("landing.start")}<ArrowUpRight size={14}/></Link></div></nav>
 <section className="intro" id="signup"><h1 className="product-title">{t("landing.titleBefore")}<span>{t("landing.titleEmphasis")}</span>{t("landing.titleAfter")}</h1><p>{t("landing.intro")}</p><LandingEntry/></section>
 <HeroDemo/>
 <section className="value-section" aria-labelledby="value-title"><div className="section-heading"><h2 id="value-title">{t("landing.valueTitle")}<br/><span>{t("landing.valueSubtitle")}</span></h2><p>{t("ui.exploreTheDetailsCompareTheEvidence")}<br/>{t("ui.andCarryUsefulConclusionsIntoYour")}</p></div><div className="feature-grid">{LANDING_FEATURES.map((f,i)=>{const Icon=featureIcons[f.icon];return <article className="feature" key={f.title}><div className="feature-top"><Icon size={22}/><span>{String(i+1).padStart(2,'0')}</span></div><h3>{t(`landing.feature.${i}.title` as MessageKey)}</h3><p>{t(`landing.feature.${i}.text` as MessageKey)}</p><div className="feature-sample">{t(`landing.feature.${i}.sample` as MessageKey)}</div></article>})}</div></section>
 <section className="faq-section" id="faq"><div><h2>{t("landing.questions")}</h2><p>{t("ui.beforeYouBegin")}<br/>{t("ui.letSAnswerAFewQuestions")}</p></div><Accordion className="faq-list">{LANDING_FAQS.map(([q],i)=><AccordionItem key={q} value={String(i)}><AccordionTrigger>{t(`landing.faq.${i}.question` as MessageKey)}</AccordionTrigger><AccordionContent>{t(`landing.faq.${i}.answer` as MessageKey)}</AccordionContent></AccordionItem>)}</Accordion></section>
 <section className="closing"><GitBranch size={32}/><h2>{t("landing.closing")}</h2><p>{t("ui.anUnfinishedRequirementADesignTo")}<br/>{t("ui.orAConceptYouHaveNot")}</p><p className="closing-last">{t("landing.closingLast")}</p><LandingEntry/></section>
 <footer><a href="#" className="footer-brand">ThreadChat</a><span>{t("landing.footer")}</span><nav className="legal-links" aria-label={t("landing.footerNav")}><PrivacySettingsButton/><Link href="/privacy">{t("common.privacy")}</Link><Link href="/terms">{t("common.terms")}</Link></nav><span>© {PROJECT.copyrightYear} {PROJECT.copyrightHolder}</span></footer>
 </main></div>}

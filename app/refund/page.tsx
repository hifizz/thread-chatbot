import type { Metadata } from "next"
import { LegalArticle } from "@/components/legal/legal-article"
import { LEGAL } from "@/constants/legal"

export const metadata: Metadata = { title: "退款政策" }

export default function RefundPage() {
  return (
    <LegalArticle title="退款政策">
      <p>
        本政策说明 {LEGAL.appName}（{LEGAL.entity}）充值额度的退款规则。支付由
        Merchant of Record（Creem）处理，退款按本政策与其规则执行。
      </p>

      <h2>1. 额度性质</h2>
      <p>充值获得的为预付费虚拟「额度」，用于按 token 抵扣本服务的使用费用。</p>

      <h2>2. 可退款情形</h2>
      <ul>
        <li>
          自充值成功之日起 {LEGAL.refundWindowDays} 天内、且相应额度
          <strong>尚未消耗</strong>的部分，可申请退款。
        </li>
        <li>因我方原因导致服务长时间不可用且无法解决的，可申请相应退款。</li>
      </ul>

      <h2>3. 不可退款情形</h2>
      <ul>
        <li>已经消耗（已用于生成回复）的额度不予退还；</li>
        <li>超过前述退款窗口期的未使用额度，是否退款由我方酌情处理；</li>
        <li>因违反《服务条款》被终止账户的，已消耗额度不退。</li>
      </ul>

      <h2>4. 如何申请</h2>
      <p>
        请发送邮件至{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
        ，注明注册邮箱、订单号与退款原因。我们核实后会通过 Creem 原路退回。
      </p>

      <h2>5. 处理时间</h2>
      <p>
        核实通过后我们会尽快发起退款；到账时间取决于支付渠道与发卡行，通常为若干个工作日。
      </p>

      <h2>6. 联系我们</h2>
      <p>
        退款相关问题请联系{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>。
      </p>
    </LegalArticle>
  )
}

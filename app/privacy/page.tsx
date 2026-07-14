import type { Metadata } from "next"
import { LegalArticle } from "@/components/legal/legal-article"
import { LEGAL, THIRD_PARTIES } from "@/constants/legal"

export const metadata: Metadata = { title: "隐私政策" }

export default function PrivacyPage() {
  return (
    <LegalArticle title="隐私政策">
      <p>
        本政策说明 {LEGAL.entity}（{LEGAL.appName}
        ）如何收集、使用与保护你的个人信息。使用本服务即表示你已阅读并理解本政策。
      </p>

      <h2>1. 我们收集的信息</h2>
      <ul>
        <li>
          <strong>账户信息</strong>：邮箱、昵称、加密后的密码。
        </li>
        <li>
          <strong>使用信息</strong>：你的对话内容、token
          用量、计费与消费记录、对话历史。
        </li>
        <li>
          <strong>支付信息</strong>：由支付服务商 Creem 处理，我们
          <strong>不存储</strong>
          你的银行卡等完整支付凭据，仅保存订单号、金额、状态等对账信息。
        </li>
        <li>
          <strong>技术信息</strong>：IP、设备与浏览器信息、日志、必要的 Cookie。
        </li>
      </ul>

      <h2>2. 我们如何使用信息</h2>
      <ul>
        <li>提供、维护与改进本服务，进行身份验证与安全防护；</li>
        <li>进行 token 计量、计费、充值到账与对账；</li>
        <li>发送验证、找回密码等必要的事务性邮件；</li>
        <li>防止滥用、欺诈与批量薅取免费额度。</li>
      </ul>

      <h2>3. 第三方服务与数据共享</h2>
      <p>为提供服务，我们会在必要范围内向以下第三方传输相关数据：</p>
      <ul>
        {THIRD_PARTIES.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong>：{p.purpose}。
          </li>
        ))}
      </ul>
      <p>
        请特别注意：<strong>你的对话内容会发送给相应的大模型供应商</strong>
        以生成回复，请勿输入你不希望被第三方处理的高度敏感信息。各第三方对其处理的数据适用其自身隐私政策。
      </p>

      <h2>4. Cookie</h2>
      <p>我们使用必要的会话 Cookie 以维持登录状态，不用于跨站广告追踪。</p>

      <h2>5. 数据保留与删除</h2>
      <p>
        我们在为你提供服务及法律要求的期限内保留信息。你可请求删除账户及关联数据；部分计费/交易记录可能因合规需要保留必要期限。
      </p>

      <h2>6. 数据安全</h2>
      <p>
        我们采取合理的技术与管理措施（如传输加密、密码哈希、访问控制）保护你的信息，但无法保证绝对安全。
      </p>

      <h2>7. 你的权利</h2>
      <p>
        在适用法律范围内，你有权访问、更正、导出或删除你的个人信息，并可撤回同意。行使权利请联系我们。
      </p>

      <h2>8. 未成年人</h2>
      <p>
        本服务不面向未达法定年龄的未成年人；如你为未成年人，请在监护人同意与指导下使用。
      </p>

      <h2>9. 政策更新</h2>
      <p>本政策如有更新将在本页公布，重大变更会以适当方式提示。</p>

      <h2>10. 联系我们</h2>
      <p>
        隐私相关问题请联系{" "}
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>。
      </p>
    </LegalArticle>
  )
}

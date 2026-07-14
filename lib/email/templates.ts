// 事务邮件的 HTML 模板（内联样式，兼容主流邮件客户端）。中文文案。

const APP_NAME = "Thread Chat"

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
    <div style="background:#fff;border-radius:14px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <div style="font-size:18px;font-weight:600;color:#111;margin-bottom:16px;">${APP_NAME}</div>
      <div style="font-size:16px;font-weight:600;color:#111;margin-bottom:12px;">${title}</div>
      ${bodyHtml}
    </div>
    <div style="text-align:center;color:#9aa0a6;font-size:12px;margin-top:16px;">
      本邮件由系统自动发送，请勿直接回复。
    </div>
  </div>
</body></html>`
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:500;">${label}</a>`
}

export function verificationEmail(url: string): {
  subject: string
  html: string
} {
  return {
    subject: `验证你的 ${APP_NAME} 邮箱`,
    html: layout(
      "验证邮箱以完成注册",
      `<p style="font-size:14px;color:#444;line-height:1.6;">点击下方按钮验证邮箱地址，验证后即可登录并获得初始体验额度。</p>
       <p style="margin:20px 0;">${button(url, "验证邮箱")}</p>
       <p style="font-size:12px;color:#9aa0a6;line-height:1.6;">若按钮无法点击，请复制以下链接到浏览器打开：<br/>${url}</p>`
    ),
  }
}

export function resetPasswordEmail(url: string): {
  subject: string
  html: string
} {
  return {
    subject: `重置你的 ${APP_NAME} 密码`,
    html: layout(
      "重置密码",
      `<p style="font-size:14px;color:#444;line-height:1.6;">我们收到了重置密码的请求。点击下方按钮设置新密码；若非本人操作，请忽略本邮件。</p>
       <p style="margin:20px 0;">${button(url, "重置密码")}</p>
       <p style="font-size:12px;color:#9aa0a6;line-height:1.6;">若按钮无法点击，请复制以下链接到浏览器打开：<br/>${url}</p>`
    ),
  }
}

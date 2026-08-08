import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { clearBrowserPreferences } from '../data/privacyStorage'
import { clearAllWordbookStudyCaches } from '../data/wordbookStudyCache'

export function PrivacyPage() {
  useDocumentTitle('隐私说明')

  function resetBrowserPreferences() {
    if (!window.confirm('重置这台浏览器中的主题、界面偏好和本地缓存？匿名身份会保留，以免失去服务器词本的访问入口；账号和匿名服务器数据都不会删除。')) return
    try {
      clearBrowserPreferences(localStorage)
      clearAllWordbookStudyCaches(localStorage)
    } finally {
      window.location.assign('/')
    }
  }

  return (
    <section className="sources-page privacy-page" aria-labelledby="privacy-title">
      <p className="marginal">PRIVACY</p>
      <h1 id="privacy-title">隐私与数据说明</h1>
      <p>本页说明 WeCreate Vocab 在提供查词、词书、学习记录和社区功能时处理的数据。最后更新：2026 年 8 月 8 日。</p>

      <article>
        <h2>账号与学习数据</h2>
        <p>注册账号保存用户名、可选的头像图片、加盐密码哈希、会话哈希、私人词书、学习事件、导入草稿、收藏和发布记录。密码与原始会话令牌不会写入数据库。</p>
        <p>匿名使用时，浏览器会在 localStorage 保存随机客户端 ID；持有该 ID 的脚本可能访问对应匿名数据，因此重要数据应注册账号保护。</p>
      </article>

      <article>
        <h2>搜索、社区与保留期限</h2>
        <p>成功查询的单词会保存最多 30 天，用于生成不含账号和 IP 的热门词统计。详细学习事件保留约 90 天，之后仅保留维持等级与复习计划所需的汇总状态；登录会话最长 30 天。留言中的可选联系方式仅管理员可见，账号注销时会被移除。</p>
      </article>

      <article>
        <h2>外部服务</h2>
        <p>本地词典未命中时，查询词可能发送给 WiktAPI。播放在线英音或美音时，浏览器会访问有道词典的发音地址，查询词会随音频请求发送给有道；该服务可能获得访问者 IP、浏览器信息和请求时间。在线音频不可用时才会回退浏览器语音合成，语音合成是否使用云服务取决于操作系统和浏览器。</p>
      </article>

      <article>
        <h2>控制自己的数据</h2>
        <p>登录后可在“账户资料”页修改密码，或导出服务器保存的账号、头像、词书、学习记录、发布内容和留言；头像可单独移除，注销账号需要再次输入用户名和密码，并会删除头像、私人学习数据、会话和发布内容，同时匿名化留言。</p>
        <p>重置本机偏好不会删除服务器上的匿名或账号数据，也不会更换匿名身份；因此不会让仍在使用的匿名词本失去访问入口。</p>
        <button type="button" onClick={resetBrowserPreferences}>重置本机偏好与缓存</button>
      </article>

      <article>
        <h2>必要存储</h2>
        <p>会话 Cookie 仅用于登录，具有 HttpOnly、SameSite 和生产环境 Secure 属性；本站没有广告跟踪器。主题、匿名身份、部分界面偏好和短期学习概览缓存保存在 localStorage，不使用非必要营销 Cookie。</p>
      </article>
    </section>
  )
}

import { Link } from 'react-router'

export function SiteFooter() {
  return <footer className="site-footer"><span className="footer-rule" aria-hidden="true" /><span className="footer-copy">为单词学习者准备的在线词库<Link to="/sources">词典来源</Link><Link to="/privacy">隐私说明</Link></span><span className="footer-rule" aria-hidden="true" /></footer>
}

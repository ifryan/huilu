import { browser } from '#imports'
import { mount } from '@/lib/mount'
import { POPUP_PORT } from '@/lib/page-capture'
import { Popup } from './Popup'

// 后台按这个端口断开得知弹窗已关闭，把图标恢复成「点击打开网页面板」
browser.runtime.connect({ name: POPUP_PORT })
void mount(<Popup />)

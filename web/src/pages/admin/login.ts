import { adminApi } from '../../api/admin'
import { h, renderPage } from '../../components/dom'
import { navigate } from '../../router'

// Owner 登录页。cookie 会话 7 天；已登录访问本页自动跳转授权管理。
export async function renderAdminLogin(): Promise<void> {
  try {
    await adminApi.whoami()
    navigate('/admin/grants')
    return
  } catch {
    /* 未登录，渲染表单 */
  }

  const err = h('p', { class: 'admin-login-err', role: 'alert' }, '')
  const username = h('input', { type: 'text', class: 'admin-input', autocomplete: 'username', placeholder: '用户名', 'aria-label': '用户名' })
  const password = h('input', { type: 'password', class: 'admin-input', autocomplete: 'current-password', placeholder: '密码', 'aria-label': '密码' })
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, '登录')

  const submit = async () => {
    btn.disabled = true
    try {
      await adminApi.login(username.value.trim(), password.value)
      navigate('/admin/grants')
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : '登录失败'
      btn.disabled = false
      password.value = ''
      password.focus()
    }
  }

  const form = h('form', {
    class: 'admin-login-form',
    onSubmit: (e: Event) => {
      e.preventDefault()
      void submit()
    },
  }, [username, password, err, btn])

  renderPage(
    h('div', { class: 'admin-login' }, [
      h('div', { class: 'glass admin-login-card' }, [
        h('div', { class: 'admin-login-brand' }, [
          h('h1', { class: 'font-accent admin-login-title' }, '圆忆'),
          h('p', { class: 'admin-login-sub' }, 'ROUNDMEMO · 授访者登录'),
        ]),
        form,
      ]),
    ]),
  )
  username.focus()
}

// 滚动进场动画：IntersectionObserver 给 [data-reveal] 元素加 .is-in（柔光淡入）。
// 卡片自身带 --rd 延迟实现首屏 stagger；进视口后逐张亮起。
// 尊重 prefers-reduced-motion：直接全亮，不做观察。
export function wireReveal(root: HTMLElement): (() => void) | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
  if (!els.length) return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((el) => el.classList.add('is-in'))
    return null
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in')
          io.unobserve(e.target)
        }
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.12 },
  )
  els.forEach((el) => io.observe(el))
  return () => io.disconnect()
}

import { ref, onMounted, onBeforeUnmount } from 'vue'

export function useLazyLoad(callback, options = {}) {
  const containerRef = ref(null)

  onMounted(() => {
    const rawEl = containerRef.value
    const el = rawEl?.$el ?? rawEl
    if (!el) { callback(); return }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          callback()
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '60px', ...options }
    )
    observer.observe(el)
    onBeforeUnmount(() => observer.disconnect())
  })

  return { containerRef }
}

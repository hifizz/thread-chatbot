/** 只滚动候选菜单，不让 scrollIntoView 连带滚动页面或 Thread。 */
export function scrollMenuOptionIntoView(menu: HTMLElement, option: HTMLElement) {
  const menuRect = menu.getBoundingClientRect()
  const optionRect = option.getBoundingClientRect()
  const top = menuRect.top + menu.clientTop
  const bottom = top + menu.clientHeight
  if (optionRect.top < top) menu.scrollTop += optionRect.top - top
  else if (optionRect.bottom > bottom) menu.scrollTop += optionRect.bottom - bottom
}

// Заглушка вместо Telegram WebApp SDK: компоненты зовут вибро-отклик и слушают события темы, на сайте это ничего не делает.
const noop = () => {}

const WebApp = {
    platform: "unknown",
    initData: "",
    viewportHeight: 0,
    HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
    onEvent: noop,
    offEvent: noop,
    expand: noop,
    ready: noop,
    setHeaderColor: noop,
    setBackgroundColor: noop,
    themeParams: {},
}

export default WebApp
export const BackButton = () => null
export const getUser = () => null
export const isTelegram = false
export const lockVerticalSwipes = () => noop
export const MainButton = () => null

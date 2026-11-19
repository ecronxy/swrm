import { createContext, useContext, useMemo } from "react"
import PropTypes from "prop-types"

// Платформа задаётся снаружи (prop skin) и не трогает body и localStorage: на странице можно показать Apple и Material рядом.
// Стили компонентов читают класс .apple / .material на обёртке превью.
export const SkinContext = createContext(null)

const FALLBACK_VALUE = { skin: "apple", isApple: true, isMaterial: false, setSkin: () => {} }

export const useSkin = () => useContext(SkinContext) || FALLBACK_VALUE

export const ensureRobotoFlex = () => {}

export default function DeviceProvider({ skin = "apple", setSkin = () => {}, children }) {
    const value = useMemo(() => ({ skin, isApple: skin === "apple", isMaterial: skin === "material", setSkin }), [skin, setSkin])
    return <SkinContext.Provider value={value}>{children}</SkinContext.Provider>
}

DeviceProvider.propTypes = {
    skin: PropTypes.oneOf(["apple", "material"]),
    setSkin: PropTypes.func,
    children: PropTypes.node,
}

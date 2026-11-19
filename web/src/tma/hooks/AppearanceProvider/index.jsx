import PropTypes from "prop-types"
import { createContext, useMemo } from "react"

export const AppearanceContext = createContext({ colorScheme: "light" })

// Светлая или тёмная схема задаётся снаружи (prop colorScheme); сами цвета лежат в tma/tokens.css на обёртке превью.
const AppearanceProvider = ({ colorScheme = "light", children }) => {
    const value = useMemo(() => ({ colorScheme }), [colorScheme])
    return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

AppearanceProvider.propTypes = {
    colorScheme: PropTypes.oneOf(["light", "dark"]),
    children: PropTypes.node,
}

export default AppearanceProvider

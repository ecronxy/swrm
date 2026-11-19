import { LazyMotion } from "motion/react"
import type { CSSProperties, ReactNode } from "react"
import "@fontsource-variable/roboto-flex"
import AppearanceProvider from "./hooks/AppearanceProvider"
import DeviceProvider from "./hooks/DeviceProvider"
import "./tokens.css"

export type Skin = "apple" | "material"
export type Scheme = "light" | "dark"

/** Анимации компонентов подгружаются отдельным куском: `m.*` без LazyMotion не двигается */
const features = () => import("motion/react").then((module) => module.domMax)

/**
 * Обёртка для компонентов мини-аппа: задаёт платформу (Apple или Material), светлую/тёмную схему и все цвета-токены.
 * Платформа и схема — свойства, а не классы на body, поэтому рядом можно показать любое число превью в разных стилях.
 */
export const TmaScope = ({ skin, scheme, className, style, children }: { skin: Skin; scheme: Scheme; className?: string; style?: CSSProperties; children: ReactNode }) => (
    <div className={`tma ${skin} ${className ?? ""}`} data-color-scheme={scheme} style={style}>
        <DeviceProvider skin={skin}>
            <LazyMotion features={features}>
                <AppearanceProvider colorScheme={scheme}>{children}</AppearanceProvider>
            </LazyMotion>
        </DeviceProvider>
    </div>
)

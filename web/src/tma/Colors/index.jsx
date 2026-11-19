import PropTypes from "prop-types"
import { useLayoutEffect, useRef, useState } from "react"

import styles from "./Colors.module.scss"

/** Токены схемы: переменная, короткая подпись и группа. Значения берутся из tokens.css, поэтому тут только имена. */
const GROUPS = [
    {
        title: "Backgrounds",
        tokens: [
            ["--tg-theme-bg-color", "bg"],
            ["--tg-theme-secondary-bg-color", "secondary bg"],
            ["--tg-theme-section-bg-color", "section bg"],
            ["--tg-theme-bottom-bar-bg-color", "bottom bar"],
        ],
    },
    {
        title: "Text",
        tokens: [
            ["--tg-theme-text-color", "text"],
            ["--tg-theme-subtitle-text-color", "subtitle"],
            ["--tg-theme-hint-color", "hint"],
            ["--tg-theme-section-header-text-color", "section header"],
            ["--text-disabled-color", "disabled"],
        ],
    },
    {
        title: "Accent",
        tokens: [
            ["--tg-theme-button-color", "button"],
            ["--tg-theme-accent-text-color", "accent text"],
            ["--tg-theme-destructive-text-color", "destructive"],
            ["--text-confirm-color", "confirm"],
        ],
    },
    {
        title: "Lines and fills",
        tokens: [
            ["--tg-theme-section-separator-color", "separator"],
            ["--tertiary-fill-background", "tertiary fill"],
            ["--quaternary-fill-background", "quaternary fill"],
            ["--button-disabled-color", "button disabled"],
        ],
    },
]

const hex2 = (n) => Math.round(n).toString(16).padStart(2, "0")

/** Цвет, каким его нарисовал браузер, в виде #rrggbb (и #rrggbbaa, если он прозрачный) */
const toHex = (css) => {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (!m) return css
    const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ""}`
}

/** Образец цвета: заливка берёт переменную схемы, а подпись показывает итоговое значение, посчитанное браузером */
const Chip = ({ token }) => {
    const swatch = useRef(null)
    const [value, setValue] = useState("")
    useLayoutEffect(() => {
        if (swatch.current) setValue(toHex(getComputedStyle(swatch.current).backgroundColor))
    })
    return (
        <span className={styles.chip}>
            <i ref={swatch} className={styles.swatch} style={{ background: `var(${token})` }} />
            <code>{value}</code>
        </span>
    )
}

Chip.propTypes = { token: PropTypes.string.isRequired }

/** Панель одной схемы: фон и цвет текста — её собственные токены, поэтому светлая и тёмная выглядят так, как будут в приложении */
const Panel = ({ scheme }) => (
    <div className={`tma ${styles.panel}`} data-color-scheme={scheme}>
        <p className={styles.scheme}>{scheme === "light" ? "Light" : "Dark"}</p>
        {GROUPS.map((group) => (
            <div key={group.title} className={styles.group}>
                <p className={styles.title}>{group.title}</p>
                {group.tokens.map(([token]) => (
                    <Chip key={token} token={token} />
                ))}
            </div>
        ))}
    </div>
)

Panel.propTypes = { scheme: PropTypes.oneOf(["light", "dark"]).isRequired }

/**
 * Цвета светлой и тёмной схемы рядом: слева названия переменных, справа два столбца — как каждая выглядит днём и ночью.
 * Всё берётся из tokens.css (`.tma` и `.tma[data-color-scheme="dark"]`), так что палитра на странице всегда совпадает с настоящей.
 * @example
 * <ThemeColors />
 * // в стилях компонента: color: var(--tg-theme-text-color); background: var(--tg-theme-section-bg-color);
 */
const ThemeColors = () => (
    <div className={styles.root}>
        <div className={styles.names}>
            <p className={styles.scheme}>&nbsp;</p>
            {GROUPS.map((group) => (
                <div key={group.title} className={styles.group}>
                    <p className={styles.title}>{group.title}</p>
                    {group.tokens.map(([token, label]) => (
                        <span key={token} className={styles.name} title={token}>
                            {label}
                        </span>
                    ))}
                </div>
            ))}
        </div>
        <Panel scheme="light" />
        <Panel scheme="dark" />
    </div>
)

export default ThemeColors

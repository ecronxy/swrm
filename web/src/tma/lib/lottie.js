import { createElement, useEffect, useRef } from "react"
import "./ecore.js"

// Плеер иконок вкладок на eCore вместо lottie-react. Снаружи тот же lottieRef, что у lottie
// (seek, stop, resetSegments, playSegments и события ready, complete), поэтому LottieIcon не меняется.
// Цвет: сцена красится в CSS color хозяина (tint: 'currentColor'). Хозяин — span: в ките у span
// тот же цвет, что fill у path (текст во вкладке, --active-color в слое [data-overlay]).
const ECorePlayer = ({ lottieRef, src, subscriptions }) => {
    const hostRef = useRef(null)
    const subsRef = useRef(subscriptions)
    subsRef.current = subscriptions

    useEffect(() => {
        const anim = window.ECore.mount(hostRef.current, src.src, {
            autoplay: false,
            loop: false,
            subframe: true,
            tint: "currentColor",
            reducedMotion: "ignore",
            // синий слой под clip-path капсулы «не виден», но обязан идти в такт с нижним, как у lottie
            pauseHidden: false,
            onComplete: () => subsRef.current?.complete?.(),
        })

        const api = {
            seek: (frame) => {
                anim.pause()
                anim.seek(frame)
            },
            stop: () => {
                anim.pause()
                anim.seek(0)
            },
            resetSegments: () => {},
            // lottie останавливает отрезок [a, b] на кадре b - 1
            playSegments: ([from, to]) =>
                anim.play(from, to > from ? to - 1 : to + 1),
        }
        lottieRef.current = api

        anim.ready.then(() => {
            if (lottieRef.current === api) subsRef.current?.ready?.()
        })

        return () => {
            anim.destroy()
            if (lottieRef.current === api) lottieRef.current = null
        }
    }, [src, lottieRef])

    return createElement("span", {
        ref: hostRef,
        style: {
            display: "block",
            height: "100%",
            aspectRatio: `${src.w} / ${src.h}`,
        },
    })
}

export default ECorePlayer

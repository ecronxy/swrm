// иконки вкладок в .ecr (eCore), собраны из material JSON рядом: node ecore/bin/ecore.js import x.json -o x.ecr
// w, h, fr, ip, op — из исходного JSON: по ним LottieIcon считает кадры отрезков, плеер — пропорции
import bagSrc from "./bag/bag_material.ecr?url"
import chartlineSrc from "./chartline/chartline_material.ecr?url"
import clockSrc from "./clock/clock_material.ecr?url"
import walletSrc from "./wallet/wallet_material.ecr?url"

export default {
    bag: { src: bagSrc, w: 28, h: 28, fr: 60, ip: 0, op: 59 },
    chartline: { src: chartlineSrc, w: 28, h: 28, fr: 60, ip: 1, op: 111 },
    clock: { src: clockSrc, w: 28, h: 28, fr: 60, ip: 0, op: 92 },
    wallet: { src: walletSrc, w: 28, h: 28, fr: 60, ip: 0, op: 61 },
}

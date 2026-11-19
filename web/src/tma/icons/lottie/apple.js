// иконки вкладок в .ecr (eCore), собраны из apple JSON рядом: node ecore/bin/ecore.js import x.json -o x.ecr
// w, h, fr, ip, op — из исходного JSON: по ним LottieIcon считает кадры отрезков, плеер — пропорции
import bagSrc from "./bag/bag_apple.ecr?url"
import chartlineSrc from "./chartline/chartline_apple.ecr?url"
import clockSrc from "./clock/clock_apple.ecr?url"
import walletSrc from "./wallet/wallet_apple.ecr?url"

export default {
    bag: { src: bagSrc, w: 40, h: 32, fr: 60, ip: 0, op: 50 },
    chartline: { src: chartlineSrc, w: 40, h: 32, fr: 60, ip: 0, op: 59 },
    clock: { src: clockSrc, w: 40, h: 32, fr: 60, ip: 0, op: 90 },
    wallet: { src: walletSrc, w: 40, h: 32, fr: 60, ip: 0, op: 50 },
}

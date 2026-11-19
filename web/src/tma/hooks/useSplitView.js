import { useMediaQuery } from "./useMediaQuery"

// swrm is a desktop page: dialogs are centered cards on wide windows, bottom sheets only on narrow ones.
export function useSplitView() {
    return useMediaQuery("(min-width: 700px)")
}

export default useSplitView

import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../lib/utils";
export function Card({ className, ...props }) {
    return _jsx("div", { className: cn("bg-white rounded-xl border border-gray-200 shadow-sm", className), ...props });
}
export function CardHeader({ className, ...props }) {
    return _jsx("div", { className: cn("px-6 py-4 border-b border-gray-100", className), ...props });
}
export function CardContent({ className, ...props }) {
    return _jsx("div", { className: cn("px-6 py-4", className), ...props });
}
export function CardTitle({ className, ...props }) {
    return _jsx("h3", { className: cn("text-base font-semibold text-gray-900", className), ...props });
}
//# sourceMappingURL=card.js.map
import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from "../lib/utils";
export function Button({ className, variant = "default", size = "md", children, disabled, onClick, type = "button" }) {
    const base = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:pointer-events-none";
    const variants = {
        default: "bg-blue-600 text-white hover:bg-blue-700",
        outline: "border border-gray-300 text-gray-700 hover:bg-gray-50",
        ghost: "text-gray-600 hover:bg-gray-100",
        destructive: "bg-red-600 text-white hover:bg-red-700",
    };
    const sizes = {
        sm: "px-3 py-1.5 text-xs",
        md: "px-4 py-2 text-sm",
        lg: "px-6 py-3 text-base",
    };
    return (_jsx("button", { type: type, className: cn(base, variants[variant], sizes[size], className), disabled: disabled, onClick: onClick, children: children }));
}
//# sourceMappingURL=button.js.map
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../lib/utils";
export const Input = React.forwardRef(({ className, ...props }, ref) => (_jsx("input", { ref: ref, className: cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 bg-white", className), ...props })));
Input.displayName = "Input";
//# sourceMappingURL=input.js.map
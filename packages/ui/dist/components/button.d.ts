export interface ButtonProps {
    variant?: "default" | "outline" | "ghost" | "destructive";
    size?: "sm" | "md" | "lg";
    className?: string;
    disabled?: boolean;
    children?: React.ReactNode;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
}
export declare function Button({ className, variant, size, children, disabled, onClick, type }: ButtonProps): import("react").JSX.Element;
//# sourceMappingURL=button.d.ts.map
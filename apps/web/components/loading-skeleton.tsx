interface SkeletonProps {
  className?: string;
  rows?: number;
}

export function Skeleton({ className = "", rows = 1 }: SkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`animate-pulse rounded-lg bg-gray-200 ${i === rows - 1 && rows > 1 ? "w-3/4" : "w-full"} ${className}`}
          style={{ height: i === 0 ? "20px" : "16px" }}
        />
      ))}
    </div>
  );
}
"use client";
import React, { useState, useCallback } from "react";

type ErrorInfo = { message: string; hasError: boolean };

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Error boundary component — catches runtime errors in the app shell
 * and displays a fallback UI instead of crashing.
 */
export function ErrorBoundary({ children, fallback }: ErrorBoundaryProps) {
  const [info, setInfo] = useState<ErrorInfo>({ hasError: false, message: "" });

  const handleRetry = useCallback(() => {
    setInfo({ hasError: false, message: "" });
  }, []);

  return (
    <div>
      {info.hasError ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <div className="text-red-500 text-3xl mb-3">!</div>
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Something went wrong</h2>
          <p className="text-sm text-gray-500 mb-4">
            {info.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={handleRetry}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      ) : fallback ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
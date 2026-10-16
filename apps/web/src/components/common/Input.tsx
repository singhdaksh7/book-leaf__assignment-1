import React, { forwardRef, useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      id,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative rounded-lg shadow-sm">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-stone-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={`block w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-stone-900 placeholder:text-stone-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-stone-50 disabled:text-stone-500 disabled:cursor-not-allowed ${
              leftIcon ? "pl-9" : ""
            } ${rightIcon ? "pr-9" : ""} ${
              error
                ? "border-red-300 focus:border-red-500 focus:ring-red-500 text-red-900"
                : "border-stone-200 hover:border-stone-300"
            } ${className}`}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-stone-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p id={errorId} className="mt-1.5 text-xs text-red-600 font-medium">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={helperId} className="mt-1.5 text-xs text-stone-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, helperText, id, className = "", disabled, ...props }, ref) => {
    const generatedId = useId();
    const textareaId = id || generatedId;
    const errorId = `${textareaId}-error`;
    const helperId = `${textareaId}-helper`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="block text-xs font-semibold uppercase tracking-wider text-stone-600 mb-1.5"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          className={`block w-full rounded-lg border bg-white px-3.5 py-2 text-sm text-stone-900 placeholder:text-stone-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 disabled:bg-stone-50 disabled:text-stone-500 disabled:cursor-not-allowed ${
            error
              ? "border-red-300 focus:border-red-500 focus:ring-red-500 text-red-900"
              : "border-stone-200 hover:border-stone-300"
          } ${className}`}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1.5 text-xs text-red-600 font-medium">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={helperId} className="mt-1.5 text-xs text-stone-500">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

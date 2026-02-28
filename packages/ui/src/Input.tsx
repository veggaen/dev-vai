import { type TextareaHTMLAttributes } from 'react';

interface InputProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onSubmit'> {
  onSubmit?: (value: string) => void;
}

export function Input({ onSubmit, className = '', ...props }: InputProps) {
  return (
    <textarea
      className={`w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${className}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const value = e.currentTarget.value.trim();
          if (value && onSubmit) {
            onSubmit(value);
            e.currentTarget.value = '';
          }
        }
      }}
      {...props}
    />
  );
}

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}

const Button = ({
  children,
  onClick = () => {},
  variant = 'primary',
  size = 'md',
  disabled = false,
  type = 'button',
  className = '',
}: ButtonProps) => {
  const baseClasses = 'font-semibold transition-all duration-normal rounded-md inline-flex items-center justify-center';

  const variantClasses = {
    primary: 'bg-accent-primary text-text-inverse hover:bg-accent-hover',
    secondary: 'bg-transparent text-text-primary border border-border-default hover:bg-bg-tertiary hover:border-border-strong',
    ghost: 'bg-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabledClasses} ${className}`}
    >
      {children}
    </button>
  );
};

export default Button;

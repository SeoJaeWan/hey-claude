interface InputProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: 'text' | 'password' | 'email';
  disabled?: boolean;
  className?: string;
}

const Input = ({
  value = '',
  onChange = () => {},
  placeholder = '',
  type = 'text',
  disabled = false,
  className = '',
}: InputProps) => {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`input w-full ${className}`}
    />
  );
};

export default Input;

// components/Material/Production/LoadingSpinner.jsx
const LoadingSpinner = ({ message = "Loading..." }) => (
  <div className="flex items-center justify-center p-8" role="status">
    <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
    <span className="ml-3 text-sm font-medium text-muted-foreground">{message}</span>
  </div>
);

export default LoadingSpinner;

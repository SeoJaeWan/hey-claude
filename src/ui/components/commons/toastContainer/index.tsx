import Toast from "../toast";
import {useToast} from "../../../contexts/toast";

const ToastContainer = () => {
    const {toasts, removeToast} = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
            {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <Toast toast={toast} onRemove={removeToast} />
                </div>
            ))}
        </div>
    );
};

export default ToastContainer;

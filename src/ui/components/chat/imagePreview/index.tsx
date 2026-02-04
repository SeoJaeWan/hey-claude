import {X} from "lucide-react";
import {useTranslation} from "../../../contexts/language";

interface ImagePreviewProps {
    src: string;
    alt?: string;
    onRemove: () => void;
}

const ImagePreview = ({src, alt = "Preview image", onRemove}: ImagePreviewProps) => {
    const {t} = useTranslation();

    return (
        <div className="relative w-20 h-20 rounded-md overflow-hidden border border-border-default">
            <img src={src} alt={alt} className="w-full h-full object-cover" />
            <button
                onClick={onRemove}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                title={t("common.removeImage")}
            >
                <X size={14} />
            </button>
        </div>
    );
};

export default ImagePreview;

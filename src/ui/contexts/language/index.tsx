import {createContext, useContext, useState, useEffect, useCallback, ReactNode} from "react";
import enLocale from "../../locales/en.json";
import koLocale from "../../locales/ko.json";

export type Language = "en" | "ko";

type LocaleData = typeof enLocale;

interface LanguageContextValue {
    language: Language;
    setLanguage: (language: Language) => void;
}

interface TranslationContextValue {
    t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);
const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error("useLanguage must be used within LanguageProvider");
    }
    return context;
};

export const useTranslation = () => {
    const context = useContext(TranslationContext);
    if (!context) {
        throw new Error("useTranslation must be used within LanguageProvider");
    }
    return context;
};

interface LanguageProviderProps {
    children: ReactNode;
    initialLanguage?: Language;
}

const locales: Record<Language, LocaleData> = {
    en: enLocale,
    ko: koLocale
};

export const LanguageProvider = ({children, initialLanguage = "en"}: LanguageProviderProps) => {
    const [language, setLanguageState] = useState<Language>(initialLanguage);
    const [locale, setLocale] = useState<LocaleData>(locales[initialLanguage]);

    useEffect(() => {
        setLocale(locales[language]);
    }, [language]);

    const setLanguage = useCallback((newLanguage: Language) => {
        setLanguageState(newLanguage);
    }, []);

    const t = useCallback(
        (key: string, params?: Record<string, string | number>): string => {
            const keys = key.split(".");
            let value: any = locale;

            for (const k of keys) {
                if (value && typeof value === "object" && k in value) {
                    value = value[k];
                } else {
                    // Key not found, return the key itself
                    return key;
                }
            }

            if (typeof value !== "string") {
                return key;
            }

            // Interpolate parameters like {{count}}
            if (params) {
                return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey) => {
                    return params[paramKey]?.toString() ?? `{{${paramKey}}}`;
                });
            }

            return value;
        },
        [locale]
    );

    return (
        <LanguageContext.Provider value={{language, setLanguage}}>
            <TranslationContext.Provider value={{t}}>{children}</TranslationContext.Provider>
        </LanguageContext.Provider>
    );
};

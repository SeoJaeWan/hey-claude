import {useEffect} from "react";
import {BrowserRouter, Routes, Route} from "react-router-dom";
import MainLayout from "./layouts/mainLayout";
import NewSessionPage from "./pages/newSession";
import ChatPage from "./pages/chat";
import SettingsPage from "./pages/settings";
import {SSEProvider} from "./contexts/sse";
import {useSettingsQuery} from "./hooks/apis/queries/settings";
import {useLanguage} from "./contexts/language";

const App = () => {
    const {data: config} = useSettingsQuery();
    const {setLanguage} = useLanguage();

    // 설정에서 언어 가져와서 적용
    useEffect(() => {
        if (config?.language) {
            setLanguage(config.language);
        }
    }, [config?.language, setLanguage]);

    return (
        <SSEProvider>
            <BrowserRouter>
                <Routes>
                    <Route element={<MainLayout />}>
                        <Route path="/" element={<NewSessionPage />} />
                        <Route path="/chat/:sessionId" element={<ChatPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </SSEProvider>
    );
};

export default App;

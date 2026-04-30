import { Route, Routes } from "react-router-dom";
import { AuthGate } from "./features/auth/AuthGate";
import { HomeFeed } from "./features/home/HomeFeed";
import { MyPage } from "./features/mypage/MyPage";
import { RegisterScreen } from "./features/register/RegisterScreen";
import { VoteDetail } from "./features/vote-detail/VoteDetail";
import "./App.css";

function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<HomeFeed />} />
        <Route path="/vote/:id" element={<VoteDetail />} />
        <Route path="/register" element={<RegisterScreen />} />
        <Route path="/mypage" element={<MyPage />} />
      </Routes>
    </AuthGate>
  );
}

export default App;

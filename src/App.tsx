import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { RouteFallback } from "./components/RouteFallback";
import { AuthGate } from "./features/auth/AuthGate";
import { HomeFeed } from "./features/home/HomeFeed";
import { UnlockProvider } from "./features/today-archive/UnlockContext";
import { UnlockErrorToast } from "./features/today-archive/UnlockErrorToast";
import "./App.css";

const TodayArchive = lazy(() =>
  import("./features/today-archive/TodayArchive").then((m) => ({
    default: m.TodayArchive,
  }))
);
const VoteDetail = lazy(() =>
  import("./features/vote-detail/VoteDetail").then((m) => ({
    default: m.VoteDetail,
  }))
);
const RegisterScreen = lazy(() =>
  import("./features/register/RegisterScreen").then((m) => ({
    default: m.RegisterScreen,
  }))
);
const MyPage = lazy(() =>
  import("./features/mypage/MyPage").then((m) => ({ default: m.MyPage }))
);
const NotFound = lazy(() =>
  import("./features/not-found/NotFound").then((m) => ({ default: m.NotFound }))
);

function App() {
  return (
    <AuthGate>
      <UnlockProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomeFeed />} />
            <Route path="/today/archive" element={<TodayArchive />} />
            <Route path="/vote/:id" element={<VoteDetail />} />
            <Route path="/register" element={<RegisterScreen />} />
            <Route path="/mypage" element={<MyPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <UnlockErrorToast />
      </UnlockProvider>
    </AuthGate>
  );
}

export default App;

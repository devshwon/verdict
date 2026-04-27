export default function App() {
  const Tag = ({ type, children }) => {
    const styles = {
      daily: { background: '#EEEDFE', color: '#3C3489' },
      game: { background: '#E1F5EE', color: '#085041' },
      love: { background: '#FBEAF0', color: '#72243E' },
      work: { background: '#FAEEDA', color: '#633806' },
      hot: { background: '#FAECE7', color: '#712B13' },
      new: { background: '#EAF3DE', color: '#27500A' },
      end: { background: '#F1EFE8', color: '#5F5E5A' },
      today: { background: '#EEEDFE', color: '#3C3489' },
    };
    return <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 8, display: 'inline-block', ...styles[type] }}>{children}</span>;
  };

  const Bar = ({ label, pct, color }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
      <span style={{ fontSize: 8, color: '#888780', width: 26 }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: '#e8e6df', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color }} />
      </div>
      <span style={{ fontSize: 8, fontWeight: 500, width: 22, textAlign: 'right', color }}>{pct}%</span>
    </div>
  );

  const Phone = ({ title, children }) => (
    <div style={{ width: 192, flexShrink: 0, border: '1.5px solid #ccc', borderRadius: 20, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: '#888', textAlign: 'center', padding: '9px 0 6px', borderBottom: '0.5px solid #eee' }}>{title}</div>
      <div style={{ flex: 1, padding: '8px 7px', display: 'flex', flexDirection: 'column', gap: 5, minHeight: 370, fontSize: 12 }}>{children}</div>
      <div style={{ display: 'flex', borderTop: '0.5px solid #eee', padding: '5px 0 4px' }}>
        {['홈', '등록', '마이'].map((t, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, background: (title === '홈 피드' && i === 0) || (title === '질문 등록' && i === 1) || (title === '마이페이지' && i === 2) ? '#534AB7' : '#ddd' }} />
            <span style={{ fontSize: 8, color: '#aaa' }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const Card = ({ today, children }) => (
    <div style={{ border: today ? '1.5px solid #7F77DD' : '0.5px solid #eee', borderRadius: 10, padding: '7px 9px', background: today ? '#EEEDFE' : '#fff' }}>{children}</div>
  );

  const Btn = ({ primary, children }) => (
    <button style={{ width: '100%', padding: '6px 0', borderRadius: 7, fontSize: 10, fontWeight: 500, border: primary ? 'none' : '0.5px solid #ddd', background: primary ? '#534AB7' : '#f5f5f5', color: primary ? '#fff' : '#333', cursor: 'pointer', marginTop: 4 }}>{children}</button>
  );

  const Ad = () => (
    <div style={{ background: '#f5f5f5', border: '0.5px dashed #ccc', borderRadius: 6, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 8, color: '#aaa' }}>광고 배너 영역</span>
    </div>
  );

  const Divider = () => <div style={{ height: '0.5px', background: '#eee', margin: '3px 0' }} />;

  const Chip = ({ bg, color, children }) => (
    <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 6, fontWeight: 500, background: bg, color, display: 'inline-block', marginBottom: 2 }}>{children}</span>
  );

  const cats = ['전체', '일상', '게임', '연애/관계', '직장/학교', '기타'];
  const catColors = { '전체': ['#534AB7', '#EEEDFE'], '게임': ['#1D9E75', '#E1F5EE'], '연애/관계': ['#D4537E', '#FBEAF0'], '직장/학교': ['#BA7517', '#FAEEDA'] };

  return (
    <div style={{ overflowX: 'auto', padding: '16px 0' }}>
      <div style={{ display: 'flex', gap: 14, width: 'max-content' }}>

        {/* 홈 피드 */}
        <Phone title="홈 피드">
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
            {cats.map(c => {
              const [bg, fg] = catColors[c] || ['#534AB7', '#EEEDFE'];
              const on = c === '전체';
              return <span key={c} style={{ fontSize: 9, padding: '3px 7px', borderRadius: 10, border: `0.5px solid ${on ? bg : '#ddd'}`, color: on ? fg : '#888', background: on ? bg : 'transparent', whiteSpace: 'nowrap', flexShrink: 0 }}>{c}</span>;
            })}
          </div>
          <Card today>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
              <Tag type="today">오늘의 투표 · 일상</Tag>
            </div>
            <div style={{ fontSize: 11, fontWeight: 500, color: '#26215C', lineHeight: 1.4, marginBottom: 3 }}>"야근 수당 없는 야근, 그냥 해?"</div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 9, fontWeight: 500, color: '#534AB7' }}>02:14:33 남음</span>
              <span style={{ fontSize: 8, color: '#888', marginLeft: 'auto' }}>3,204명</span>
            </div>
            <Btn primary>투표하기</Btn>
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}><Tag type="game">게임</Tag><Tag type="hot">인기</Tag><span style={{ fontSize: 8, color: '#888', marginLeft: 'auto' }}>892명</span></div>
            <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>"캐리 못하면 트롤인가?"</div>
            <Bar label="그렇다" pct={61} color="#1D9E75" />
            <Bar label="아니다" pct={39} color="#B4B2A9" />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}><Tag type="love">연애/관계</Tag><Tag type="new">신규</Tag><span style={{ fontSize: 8, color: '#888', marginLeft: 'auto' }}>45분 남음</span></div>
            <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>"첫 만남 더치페이, 괜찮아?"</div>
            <Btn>투표 참여</Btn>
          </Card>
          <Ad />
          <Card>
            <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}><Tag type="work">직장/학교</Tag><Tag type="end">마감</Tag><span style={{ fontSize: 8, color: '#888', marginLeft: 'auto' }}>1,120명</span></div>
            <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 4 }}>"상사 욕 뒤에서 하는 거 나쁜가?"</div>
            <Bar label="나쁘다" pct={28} color="#888780" />
            <Bar label="아니다" pct={72} color="#534AB7" />
          </Card>
        </Phone>

        {/* 결과 상세 */}
        <Phone title="결과 상세">
          <span style={{ fontSize: 9, color: '#888' }}>← 뒤로</span>
          <Tag type="game">게임</Tag>
          <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>"캐리 못하면 트롤인가?"</div>
          <span style={{ fontSize: 9, color: '#888' }}>892명 참여 · 마감</span>
          <Divider />
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>전체 결과</span>
          <Bar label="그렇다" pct={61} color="#1D9E75" />
          <Bar label="아니다" pct={39} color="#B4B2A9" />
          <Divider />
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>성별</span>
          <Chip bg="#E6F1FB" color="#0C447C">남성 · 그렇다 58%</Chip>
          <Chip bg="#FBEAF0" color="#72243E">여성 · 그렇다 67%</Chip>
          <Divider />
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>연령대별</span>
          <Chip bg="#EAF3DE" color="#27500A">20대 · 그렇다 71%</Chip>
          <Chip bg="#FAEEDA" color="#633806">30대 · 그렇다 54%</Chip>
          <Chip bg="#F1EFE8" color="#5F5E5A">40대+ · 그렇다 48%</Chip>
          <Divider />
          <Ad />
          <Btn primary>결과 공유하기</Btn>
        </Phone>

        {/* 질문 등록 */}
        <Phone title="질문 등록">
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>질문 입력 (최대 60자)</span>
          <div style={{ border: '0.5px solid #eee', borderRadius: 8, padding: 8, background: '#f9f9f9', fontSize: 9, color: '#aaa' }}>"궁금한 상황을 입력하세요..."</div>
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>선택지 (2~5개)</span>
          {['선택지 1', '선택지 2'].map(s => <div key={s} style={{ border: '0.5px solid #eee', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#555' }}>{s}</div>)}
          <div style={{ border: '0.5px dashed #ddd', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#aaa' }}>+ 선택지 추가 (최대 5개)</div>
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>카테고리</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {['일상', '게임', '연애/관계', '직장/학교', '기타'].map((c, i) => (
              <span key={c} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 8, border: i === 0 ? 'none' : '0.5px solid #ddd', background: i === 0 ? '#534AB7' : 'transparent', color: i === 0 ? '#fff' : '#888' }}>{c}</span>
            ))}
          </div>
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>투표 기간</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {['10분', '30분', '1시간', '6시간', '24시간'].map((t, i) => (
              <span key={t} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 8, border: i === 2 ? 'none' : '0.5px solid #ddd', background: i === 2 ? '#534AB7' : 'transparent', color: i === 2 ? '#fff' : '#888' }}>{t}</span>
            ))}
          </div>
          <Divider />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9, color: '#555' }}>오늘의 투표 후보 신청</span>
            <div style={{ width: 28, height: 16, borderRadius: 8, background: '#534AB7', position: 'relative', flexShrink: 0 }}>
              <div style={{ position: 'absolute', right: 2, top: 2, width: 12, height: 12, borderRadius: '50%', background: '#fff' }} />
            </div>
          </div>
          <span style={{ fontSize: 8, color: '#aaa' }}>선정 시 포인트 100~500원 지급</span>
          <div style={{ flex: 1 }} />
          <Btn primary>등록하기</Btn>
        </Phone>

        {/* 마이페이지 */}
        <Phone title="마이페이지">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 6 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#EEEDFE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: '#3C3489', flexShrink: 0 }}>익</div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>익명 사용자</div>
              <div style={{ fontSize: 8, color: '#888' }}>토스 인증 완료</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#534AB7' }}>350원</div>
              <div style={{ fontSize: 8, color: '#aaa' }}>누적 포인트</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
            {[['12', '올린 투표'], ['47', '참여한 투표'], ['3', '상단 선정']].map(([n, l], i) => (
              <div key={l} style={{ flex: 1, border: '0.5px solid #eee', borderRadius: 8, padding: 6, textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: i === 2 ? '#534AB7' : '#222' }}>{n}</div>
                <div style={{ fontSize: 8, color: '#888' }}>{l}</div>
              </div>
            ))}
          </div>
          <Divider />
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>내가 올린 투표</span>
          {[
            { q: '캐리 못하면 트롤인가?', sub: '게임 · 892명 · 마감', badge: '결과보기', on: false },
            { q: '야근 거절 가능한가?', sub: '직장/학교 · 진행중', badge: '진행중', on: true },
          ].map(r => (
            <div key={r.q} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '0.5px solid #eee' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500 }}>{r.q}</div>
                <div style={{ fontSize: 8, color: '#888' }}>{r.sub}</div>
              </div>
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 6, background: r.on ? '#EEEDFE' : '#f5f5f5', color: r.on ? '#3C3489' : '#888' }}>{r.badge}</span>
            </div>
          ))}
          <Divider />
          <span style={{ fontSize: 9, fontWeight: 500, color: '#888' }}>참여한 투표</span>
          {[
            { q: '카톡 읽씹 화남?', sub: '내 선택: 화남', badge: '일치', match: true },
            { q: 'SNS 전 연인 보기', sub: '내 선택: 잘못', badge: '불일치', match: false },
          ].map(r => (
            <div key={r.q} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '0.5px solid #eee' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 500 }}>{r.q}</div>
                <div style={{ fontSize: 8, color: '#888' }}>{r.sub}</div>
              </div>
              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 6, background: r.match ? '#EEEDFE' : '#FAECE7', color: r.match ? '#3C3489' : '#712B13' }}>{r.badge}</span>
            </div>
          ))}
        </Phone>

      </div>
    </div>
  );
}

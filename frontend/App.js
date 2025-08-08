import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  TextInput,
  Button,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';

const ENV_API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || '';      // 배포/고정 도메인
const ENV_BOOTSTRAP = process.env.EXPO_PUBLIC_BOOTSTRAP_URL || '';    // 개발용: PC-LAN-IP:8000

// fetch JSON with timeout
async function fetchJSON(url, { method = 'GET', headers, body, timeout = 5000 } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 서버가 JSON이 아닐 수도 있어서 raw 유지 */ }
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    clearTimeout(id);
  }
}

export default function App() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const [result, setResult] = useState(null);
  const [backendURL, setBackendURL] = useState('');
  const [backendSource, setBackendSource] = useState(''); // 'env' | 'ngrok' | 'bootstrap'
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);

  // ✅ 초기 Base URL 결정 로직
  useEffect(() => {
    const initBaseURL = async () => {
      try {
        // 1) 고정 도메인(배포) 우선
        if (ENV_API_BASE) {
          setBackendURL(ENV_API_BASE.replace(/\/+$/, ''));
          setBackendSource('env');
          return;
        }

        // 2) 개발용 부트스트랩이 없으면 안내
        if (!ENV_BOOTSTRAP) {
          setBackendURL(''); // 버튼 비활성화
          setBackendSource('');
          Alert.alert(
            '설정 필요',
            'EXPO_PUBLIC_BOOTSTRAP_URL이 설정되지 않았습니다.\n예: http://<PC-LAN-IP>:8000'
          );
          return;
        }

        const bootstrap = ENV_BOOTSTRAP.replace(/\/+$/, '');
        // 2-1) 먼저 부트스트랩 주소를 기본으로 설정
        setBackendURL(bootstrap);
        setBackendSource('bootstrap');

        // 2-2) 부트스트랩에서 /ngrok-url로 최신 퍼블릭 주소 조회
        const { ok, data } = await fetchJSON(`${bootstrap}/ngrok-url`, { timeout: 3000 });
        if (ok && data?.ngrok_url) {
          setBackendURL(String(data.ngrok_url).replace(/\/+$/, ''));
          setBackendSource(data?.source || 'ngrok'); // env|ngrok
        } // 실패하면 bootstrap을 그대로 사용
      } catch (e) {
        // 어떤 에러가 나도 bootstrap 계속 사용
      } finally {
        setBootstrapping(false);
      }
    };
    initBaseURL();
  }, []);

  const canSubmit = useMemo(() => {
    return !!backendURL && !loading && title.trim().length > 0 && content.trim().length > 0;
  }, [backendURL, loading, title, content]);

  const handleSubmit = async () => {
    if (!backendURL) {
      Alert.alert('백엔드 주소 없음', '백엔드 URL을 아직 가져오지 못했습니다.');
      return;
    }
    if (!title.trim() || !content.trim()) {
      Alert.alert('입력 필요', '제목과 내용을 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append('title', title.trim());
    formData.append('content', content.trim());

    try {
      const { ok, status, data, raw } = await fetchJSON(`${backendURL}/analyze`, {
        method: 'POST',
        body: formData,
        timeout: 15000,
      });

      if (!ok) {
        setResult({
          error: `서버 오류 (HTTP ${status})`,
          raw_response: typeof raw === 'string' ? raw.slice(0, 500) : JSON.stringify(data)?.slice(0, 500),
        });
        return;
      }

      // 안전을 위해 키 존재 확인
      if (data?.emotion_score == null || data?.truth_score == null) {
        setResult({
          error: '응답 형식이 올바르지 않습니다.',
          raw_response: JSON.stringify(data)?.slice(0, 500),
        });
        return;
      }

      setResult({
        emotion_score: data.emotion_score,
        truth_score: data.truth_score,
      });
    } catch (error) {
      setResult({ error: `요청 실패: ${String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* 상태/디버그 박스 */}
        <View style={styles.debugBox}>
          <Text style={styles.debugTitle}>Backend</Text>
          <Text selectable style={styles.debugText}>
            URL: {backendURL || '(없음)'}
          </Text>
          <Text style={styles.debugText}>Source: {backendSource || '-'}</Text>
          {bootstrapping && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator />
              <Text style={styles.debugText}>주소 확인 중…</Text>
            </View>
          )}
        </View>

        <Text style={styles.label}>제목</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="제목을 입력하세요"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>내용</Text>
        <TextInput
          style={[styles.input, { height: 120 }]}
          value={content}
          onChangeText={setContent}
          placeholder="내용을 입력하세요"
          multiline
        />

        <View style={{ marginTop: 16 }}>
          <Button
            title={loading ? '분석 중…' : '분석 요청'}
            onPress={handleSubmit}
            disabled={!canSubmit}
          />
        </View>

        {result && result.emotion_score != null && result.truth_score != null && (
          <View style={styles.resultBox}>
            <Text style={styles.resultTitle}>📊 분석 결과</Text>
            <Text>감정 점수: {result.emotion_score}</Text>
            <Text>진정성 점수: {result.truth_score}</Text>
          </View>
        )}

        {result?.error && (
          <View style={[styles.resultBox, { backgroundColor: '#ffe6e6', borderColor: '#ffcccc' }]}>
            <Text style={{ color: '#b00020', fontWeight: '600' }}>{result.error}</Text>
            {result.raw_response && (
              <Text style={{ marginTop: 8, color: '#333' }}>{result.raw_response}</Text>
            )}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 6,
  },
  label: {
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  resultBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    gap: 4,
  },
  resultTitle: {
    fontWeight: '700',
    marginBottom: 6,
  },
  debugBox: {
    marginBottom: 10,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
  },
  debugTitle: {
    fontWeight: '700',
    marginBottom: 6,
  },
  debugText: {
    color: '#334155',
  },
});

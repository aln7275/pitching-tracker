import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

function splitSeconds(totalSeconds: number | null): { min: string; sec: string } {
  if (totalSeconds == null) return { min: '', sec: '' };
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return {
    min: m > 0 ? String(m) : '',
    sec: s > 0 || m === 0 ? String(s) : '',
  };
}

export function DurationInput({
  totalSeconds,
  onChange,
  label,
  disabled,
}: {
  totalSeconds: number | null;
  onChange: (totalSeconds: number | null) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [min, setMin] = useState(() => splitSeconds(totalSeconds).min);
  const [sec, setSec] = useState(() => splitSeconds(totalSeconds).sec);

  const emit = (nextMin: string, nextSec: string) => {
    if (nextMin.trim() === '' && nextSec.trim() === '') {
      onChange(null);
      return;
    }
    const m = parseInt(nextMin, 10) || 0;
    const s = parseInt(nextSec, 10) || 0;
    onChange(m * 60 + s);
  };

  return (
    <View>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.row}>
        <TextInput
          style={[styles.input, disabled && styles.inputDisabled]}
          keyboardType="numeric"
          placeholder="0"
          value={min}
          editable={!disabled}
          onChangeText={(v) => {
            setMin(v);
            emit(v, sec);
          }}
        />
        <Text style={styles.unit}>min</Text>
        <TextInput
          style={[styles.input, disabled && styles.inputDisabled]}
          keyboardType="numeric"
          placeholder="0"
          value={sec}
          editable={!disabled}
          onChangeText={(v) => {
            setSec(v);
            emit(min, v);
          }}
        />
        <Text style={styles.unit}>sec</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: '#888', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    width: 44,
    textAlign: 'center',
  },
  inputDisabled: { backgroundColor: '#f0f0f0', color: '#999' },
  unit: { fontSize: 11, color: '#999', marginRight: 6 },
});

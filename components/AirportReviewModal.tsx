/**
 * components/AirportReviewModal.tsx
 *
 * Quick structured questionnaire shown after "I've Flown Here" or when
 * editing an existing report. All fields optional, all tap-based.
 */

import { useEffect, useState } from 'react';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../lib/supabase';

const SKY = '#38BDF8';

// ── Option definitions ──────────────────────────────────────────────────────

const COURTESY_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'yes', label: 'Yes', icon: 'car' },
  { value: 'no', label: 'No', icon: 'car-off' },
  { value: 'unknown', label: 'Not sure', icon: 'help-circle-outline' },
];

const FBO_OPTIONS = [
  'Signature Flight Support', 'Atlantic Aviation', 'Million Air', 'Other', 'Not sure',
];

const FEE_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'No fees' },
  { value: 'landing_fee', label: 'Landing fee' },
  { value: 'ramp_fee', label: 'Ramp fee' },
  { value: 'handling_fee', label: 'Handling fee' },
  { value: 'multiple', label: 'Multiple' },
  { value: 'not_sure', label: 'Not sure' },
];

const FUEL_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '100LL', label: '100LL' },
  { value: 'Jet A', label: 'Jet A' },
  { value: 'MoGas', label: 'MoGas' },
  { value: 'UL94', label: 'UL94' },
];

const FUEL_SERVICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'self_serve', label: 'Self-serve' },
  { value: 'full_service', label: 'Full service' },
  { value: 'both', label: 'Both' },
  { value: 'not_sure', label: 'Not sure' },
];

const YES_NO_UNSURE: { value: string; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'not_sure', label: 'Not sure' },
];

const TRANSPORT_OPTIONS: { value: string; label: string; icon: string }[] = [
  { value: 'courtesy_car', label: 'Courtesy car', icon: 'car' },
  { value: 'uber_lyft', label: 'Uber / Lyft', icon: 'cellphone' },
  { value: 'rental_car', label: 'Rental car', icon: 'car-key' },
  { value: 'walkable', label: 'Walkable', icon: 'walk' },
  { value: 'shuttle', label: 'Shuttle', icon: 'bus' },
];

const FOOD_ACCESS_OPTIONS: { value: string; label: string }[] = [
  { value: 'on_field', label: 'On field' },
  { value: 'walkable', label: 'Walkable' },
  { value: 'courtesy_car_needed', label: 'Need car' },
  { value: 'uber_needed', label: 'Need Uber' },
  { value: 'not_sure', label: 'Not sure' },
];

const VISIT_REASONS: { value: string; label: string; icon: string }[] = [
  { value: 'food', label: 'Food', icon: 'silverware-fork-knife' },
  { value: 'golf', label: 'Golf', icon: 'golf' },
  { value: 'scenic', label: 'Scenic', icon: 'image-filter-hdr' },
  { value: 'event', label: 'Event', icon: 'calendar-star' },
  { value: 'quick_stop', label: 'Quick Stop', icon: 'airplane-landing' },
  { value: 'other', label: 'Other', icon: 'dots-horizontal' },
];

const REASON_LABEL: Record<string, string> = {
  food: 'Food', golf: 'Golf', scenic: 'Scenic', event: 'Event',
  quick_stop: 'Quick Stop', other: 'Other',
};

export interface ExistingReview {
  id: string;
  courtesy_car: string | null;
  fuel_available: boolean | null;
  fuel_types: string[] | null;
  fuel_prices: Record<string, number> | null;
  fuel_price: number | null;
  fuel_service_type: string | null;
  fbo_name: string | null;
  fbo_rating: number | null;
  fee_status: string | null;
  fee_amount_text: string | null;
  after_hours_access: string | null;
  transport_options: string[] | null;
  overnight_friendly: string | null;
  food_access: string | null;
  visit_reason: string | null;
  notes: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  airportIcao: string;
  userId: string;
  existingReview?: ExistingReview | null;
}

export default function AirportReviewModal({ visible, onClose, airportIcao, userId, existingReview }: Props) {
  // ── Existing fields ────────────────────────────────────────────────────────
  const [courtesyCar, setCourtesyCar] = useState<string | null>(null);
  const [fuelAvailable, setFuelAvailable] = useState<boolean | null>(null);
  const [fuelTypes, setFuelTypes] = useState<string[]>([]);
  const [fuelPrices, setFuelPrices] = useState<Record<string, string>>({});
  const [fuelServiceType, setFuelServiceType] = useState<string | null>(null);
  const [fboName, setFboName] = useState<string | null>(null);
  const [fboOtherText, setFboOtherText] = useState('');
  const [fboRating, setFboRating] = useState<number | null>(null);
  const [visitReason, setVisitReason] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  // ── New V2 fields ──────────────────────────────────────────────────────────
  const [feeStatus, setFeeStatus] = useState<string | null>(null);
  const [feeAmountText, setFeeAmountText] = useState('');
  const [afterHoursAccess, setAfterHoursAccess] = useState<string | null>(null);
  const [transportOptions, setTransportOptions] = useState<string[]>([]);
  const [overnightFriendly, setOvernightFriendly] = useState<string | null>(null);
  const [foodAccess, setFoodAccess] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const isEdit = !!existingReview;

  // ── Pre-fill for edit mode ─────────────────────────────────────────────────
  useEffect(() => {
    if (visible && existingReview) {
      setCourtesyCar(existingReview.courtesy_car);
      setFuelAvailable(existingReview.fuel_available);
      const types = existingReview.fuel_types ?? [];
      setFuelTypes(types);
      // Use per-type prices if available, fall back to legacy single price
      if (existingReview.fuel_prices && Object.keys(existingReview.fuel_prices).length > 0) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(existingReview.fuel_prices)) mapped[k] = String(v);
        setFuelPrices(mapped);
      } else if (existingReview.fuel_price && types.length > 0) {
        setFuelPrices({ [types[0]]: String(existingReview.fuel_price) });
      } else {
        setFuelPrices({});
      }
      setFuelServiceType(existingReview.fuel_service_type);
      const storedFbo = existingReview.fbo_name;
      if (storedFbo && FBO_OPTIONS.includes(storedFbo)) { setFboName(storedFbo); }
      else if (storedFbo) { setFboName('Other'); setFboOtherText(storedFbo); }
      setFboRating(existingReview.fbo_rating);
      setFeeStatus(existingReview.fee_status);
      setFeeAmountText(existingReview.fee_amount_text ?? '');
      setAfterHoursAccess(existingReview.after_hours_access);
      setTransportOptions(existingReview.transport_options ?? []);
      setOvernightFriendly(existingReview.overnight_friendly);
      setFoodAccess(existingReview.food_access);
      setVisitReason(existingReview.visit_reason);
      setNotes(existingReview.notes ?? '');
      // Auto-expand if any secondary fields have data
      if (existingReview.fee_status || existingReview.after_hours_access ||
          (existingReview.transport_options && existingReview.transport_options.length > 0) ||
          existingReview.overnight_friendly || existingReview.food_access) {
        setShowMore(true);
      }
    }
  }, [visible, existingReview?.id]);

  function reset() {
    setCourtesyCar(null); setFuelAvailable(null); setFuelTypes([]); setFuelPrices({});
    setFuelServiceType(null); setFboName(null); setFboOtherText('');
    setFboRating(null); setFeeStatus(null); setFeeAmountText('');
    setAfterHoursAccess(null); setTransportOptions([]);
    setOvernightFriendly(null); setFoodAccess(null);
    setVisitReason(null); setNotes(''); setSubmitted(false); setSaving(false);
    setSaveError(null); setShowMore(false);
  }

  function handleClose() { reset(); onClose(); }

  function hasContent(): boolean {
    return !!(courtesyCar || fuelAvailable !== null || fboName || fboRating ||
      feeStatus || afterHoursAccess || transportOptions.length || overnightFriendly ||
      foodAccess || fuelServiceType || visitReason || notes.trim());
  }

  function toggleTransport(val: string) {
    setTransportOptions(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  }

  async function submit() {
    if (!hasContent()) return;
    setSaving(true);
    try {
      // Core fields that always exist in the table
      const payload: Record<string, any> = {
        user_id: userId,
        airport_icao: airportIcao.toUpperCase(),
        courtesy_car: courtesyCar,
        fuel_available: fuelAvailable,
        fuel_price: (() => {
          if (!fuelAvailable) return null;
          const prices = Object.values(fuelPrices).filter(p => p.trim()).map(p => parseFloat(p)).filter(n => !isNaN(n) && n > 0);
          return prices.length > 0 ? Math.min(...prices) : null;
        })(),
        fbo_name: fboName === 'Other' ? (fboOtherText.trim() || 'Other') : fboName === 'Not sure' ? null : fboName,
        fbo_rating: fboRating,
        visit_reason: visitReason,
        notes: notes.trim() || null,
      };

      // V2 fields — added via migration, may not exist yet
      const v2Fields: Record<string, any> = {
        fuel_types: fuelAvailable && fuelTypes.length > 0 ? fuelTypes : null,
        fuel_prices: (() => {
          if (!fuelAvailable) return null;
          const obj: Record<string, number> = {};
          for (const [k, v] of Object.entries(fuelPrices)) {
            if (k === '_default') continue;
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) obj[k] = n;
          }
          return Object.keys(obj).length > 0 ? obj : null;
        })(),
        fuel_service_type: fuelAvailable ? fuelServiceType : null,
        fee_status: feeStatus,
        fee_amount_text: (feeStatus && feeStatus !== 'none' && feeStatus !== 'not_sure' && feeAmountText.trim()) ? feeAmountText.trim() : null,
        after_hours_access: afterHoursAccess,
        transport_options: transportOptions.length > 0 ? transportOptions : null,
        overnight_friendly: overnightFriendly,
        food_access: foodAccess,
      };

      // Try with all fields first
      const fullPayload = { ...payload, ...v2Fields };
      let error: any;
      if (isEdit && existingReview) {
        ({ error } = await supabase.from('airport_reviews').update(fullPayload).eq('id', existingReview.id));
      } else {
        ({ error } = await supabase.from('airport_reviews').insert(fullPayload));
      }

      // If V2 columns don't exist, retry with core fields only
      if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
        if (__DEV__) console.warn('[Review] V2 columns missing, retrying with core fields:', error.message);
        if (isEdit && existingReview) {
          ({ error } = await supabase.from('airport_reviews').update(payload).eq('id', existingReview.id));
        } else {
          ({ error } = await supabase.from('airport_reviews').insert(payload));
        }
      }

      if (error) {
        if (__DEV__) console.warn('[Review] save error:', error.message);
        setSaveError(error.message);
      } else {
        if (__DEV__) console.log('[Review]', isEdit ? 'updated' : 'created', 'for', airportIcao);
        setSubmitted(true); setSaving(false); return;
      }
    } catch (e: any) {
      if (__DEV__) console.warn('[Review] exception:', e?.message);
      setSaveError(e?.message ?? 'Something went wrong');
    }
    setSaving(false);
  }

  // ── Success confirmation ──────────────────────────────────────────────────
  if (submitted) {
    const items: { icon: string; text: string }[] = [];
    if (feeStatus && feeStatus !== 'not_sure') items.push({ icon: 'cash', text: feeStatus === 'none' ? 'No fees' : `Fees: ${feeStatus.replace('_', ' ')}${feeAmountText.trim() ? ` (${feeAmountText.trim()})` : ''}` });
    if (courtesyCar && courtesyCar !== 'unknown') items.push({ icon: 'car', text: `Crew car: ${courtesyCar === 'yes' ? 'Yes' : 'No'}` });
    if (fuelAvailable !== null) {
      if (fuelAvailable && fuelTypes.length > 0) {
        const parts = fuelTypes.map(t => {
          const p = fuelPrices[t];
          return p?.trim() ? `${t}: $${p}/gal` : t;
        });
        items.push({ icon: 'gas-station', text: parts.join(', ') });
      } else {
        items.push({ icon: 'gas-station', text: fuelAvailable ? 'Fuel available' : 'No fuel' });
      }
    }
    if (fboName && fboName !== 'Not sure') items.push({ icon: 'office-building', text: fboName === 'Other' ? (fboOtherText.trim() || 'Other FBO') : fboName });
    if (fboRating) items.push({ icon: 'star', text: `FBO: ${fboRating}/5` });
    if (afterHoursAccess && afterHoursAccess !== 'not_sure') items.push({ icon: 'clock-outline', text: `After hours: ${afterHoursAccess === 'yes' ? 'Yes' : 'No'}` });
    if (transportOptions.length > 0) items.push({ icon: 'road-variant', text: transportOptions.map(t => t.replace('_', ' ')).join(', ') });
    if (overnightFriendly && overnightFriendly !== 'not_sure') items.push({ icon: 'weather-night', text: `Overnight: ${overnightFriendly === 'yes' ? 'Yes' : 'No'}` });
    if (foodAccess && foodAccess !== 'not_sure') items.push({ icon: 'silverware-fork-knife', text: `Food: ${foodAccess.replace(/_/g, ' ')}` });
    if (notes.trim()) items.push({ icon: 'message-text', text: notes.trim().length > 60 ? notes.trim().slice(0, 60) + '...' : notes.trim() });

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={s.overlay}>
          <TouchableOpacity style={s.overlayBg} activeOpacity={1} onPress={handleClose} />
          <View style={s.sheet}>
            <View style={s.handle} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
              <View style={s.successIcon}>
                <Feather name="check-circle" size={32} color="#34D399" />
              </View>
              <Text style={s.successTitle}>Report {isEdit ? 'Updated' : 'Submitted'}</Text>
              <Text style={s.successSub}>Thanks for helping other pilots at {airportIcao.toUpperCase()}</Text>
              {items.length > 0 && (
                <View style={s.summaryCard}>
                  {items.map((item, i) => (
                    <View key={i} style={[s.summaryRow, i < items.length - 1 && s.summaryRowBorder]}>
                      <MaterialCommunityIcons name={item.icon as any} size={14} color="#6B83A0" />
                      <Text style={s.summaryText}>{item.text}</Text>
                    </View>
                  ))}
                </View>
              )}
              <TouchableOpacity style={s.submitBtn} onPress={handleClose} activeOpacity={0.8}>
                <Text style={s.submitText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.overlayBg} activeOpacity={1} onPress={handleClose} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <View style={s.headerRow}>
              <MaterialCommunityIcons name="clipboard-edit-outline" size={20} color={SKY} />
              <Text style={s.headerTitle}>{isEdit ? 'Update Report' : 'Quick Airport Review'}</Text>
            </View>
            <Text style={s.headerSub}>{airportIcao.toUpperCase()} — takes ~10 seconds</Text>

            {/* ════════ PRIMARY FIELDS (always visible) ════════ */}

            {/* Courtesy / Crew Car */}
            <Text style={s.label}>COURTESY / CREW CAR</Text>
            <View style={s.chipRow}>
              {COURTESY_OPTIONS.map(opt => (
                <Chip key={opt.value} label={opt.label} icon={opt.icon} active={courtesyCar === opt.value}
                  onPress={() => setCourtesyCar(courtesyCar === opt.value ? null : opt.value)} />
              ))}
            </View>

            {/* Fuel */}
            <Text style={s.label}>FUEL AVAILABLE</Text>
            <View style={s.chipRow}>
              <Chip label="Yes" icon="gas-station" active={fuelAvailable === true}
                onPress={() => setFuelAvailable(fuelAvailable === true ? null : true)} />
              <Chip label="No" icon="gas-station-off" active={fuelAvailable === false}
                onPress={() => setFuelAvailable(fuelAvailable === false ? null : false)} />
            </View>
            {fuelAvailable && (
              <>
                <Text style={s.label}>FUEL TYPES <Text style={s.optionalTag}>MULTI-SELECT</Text></Text>
                <View style={s.chipRow}>
                  {FUEL_TYPE_OPTIONS.map(opt => (
                    <Chip key={opt.value} label={opt.label}
                      active={fuelTypes.includes(opt.value)}
                      onPress={() => setFuelTypes(prev =>
                        prev.includes(opt.value) ? prev.filter(v => v !== opt.value) : [...prev, opt.value]
                      )} />
                  ))}
                </View>
                {fuelTypes.length > 0 ? fuelTypes.map(ft => (
                  <View key={ft} style={s.fuelPriceRow}>
                    <Text style={s.fuelPriceLabel}>{ft} price</Text>
                    <TextInput style={s.fuelPriceInput} placeholder="$6.50"
                      placeholderTextColor="#4A5B73" value={fuelPrices[ft] ?? ''}
                      onChangeText={t => setFuelPrices(prev => ({ ...prev, [ft]: t.replace(/[^0-9.]/g, '') }))}
                      keyboardType="decimal-pad" maxLength={6} />
                  </View>
                )) : (
                  <View style={s.fuelPriceRow}>
                    <Text style={s.fuelPriceLabel}>Price per gal</Text>
                    <TextInput style={s.fuelPriceInput} placeholder="$6.50"
                      placeholderTextColor="#4A5B73" value={fuelPrices['_default'] ?? ''}
                      onChangeText={t => setFuelPrices(prev => ({ ...prev, _default: t.replace(/[^0-9.]/g, '') }))}
                      keyboardType="decimal-pad" maxLength={6} />
                  </View>
                )}
              </>
            )}

            {/* FBO */}
            <Text style={s.label}>FBO</Text>
            <View style={s.chipRow}>
              {FBO_OPTIONS.map(opt => (
                <Chip key={opt} label={opt} active={fboName === opt}
                  onPress={() => { setFboName(fboName === opt ? null : opt); if (opt !== 'Other') setFboOtherText(''); }} />
              ))}
            </View>
            {fboName === 'Other' && (
              <TextInput style={s.inlineInput} placeholder="FBO name" placeholderTextColor="#4A5B73"
                value={fboOtherText} onChangeText={setFboOtherText} maxLength={60} autoCapitalize="words" />
            )}

            {/* FBO Rating */}
            <Text style={s.label}>FBO RATING</Text>
            <View style={s.starRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setFboRating(fboRating === n ? null : n)} activeOpacity={0.7} style={s.starBtn}>
                  <MaterialCommunityIcons
                    name={fboRating && n <= fboRating ? 'star' : 'star-outline'} size={28}
                    color={fboRating && n <= fboRating ? '#FBBF24' : '#2A3A52'} />
                </TouchableOpacity>
              ))}
            </View>

            {/* Notes */}
            <Text style={s.label}>NOTES <Text style={s.optionalTag}>OPTIONAL</Text></Text>
            <TextInput style={s.notesInput} placeholder="Anything useful for other pilots..."
              placeholderTextColor="#4A5B73" value={notes} onChangeText={setNotes}
              multiline maxLength={280} textAlignVertical="top" />

            {/* ════════ SECONDARY FIELDS (progressive disclosure) ════════ */}

            {!showMore && (
              <TouchableOpacity style={s.moreToggle} onPress={() => setShowMore(true)} activeOpacity={0.7}>
                <Feather name="plus-circle" size={16} color={SKY} />
                <Text style={s.moreToggleText}>Add more details</Text>
                <Text style={s.moreToggleHint}>fees, transport, food, overnight</Text>
              </TouchableOpacity>
            )}

            {showMore && (
              <>
                <View style={s.moreDivider} />

                {/* Fees */}
                <Text style={s.label}>FEES / GOTCHAS</Text>
                <View style={s.chipRow}>
                  {FEE_OPTIONS.map(opt => (
                    <Chip key={opt.value} label={opt.label} active={feeStatus === opt.value}
                      onPress={() => setFeeStatus(feeStatus === opt.value ? null : opt.value)} />
                  ))}
                </View>
                {feeStatus && feeStatus !== 'none' && feeStatus !== 'not_sure' && (
                  <TextInput style={s.inlineInput} placeholder="Amount (optional, e.g. $25)"
                    placeholderTextColor="#4A5B73" value={feeAmountText}
                    onChangeText={setFeeAmountText} maxLength={30} />
                )}

                {/* Fuel Service (only if fuel available) */}
                {fuelAvailable && (
                  <>
                    <Text style={s.label}>FUEL SERVICE</Text>
                    <View style={s.chipRow}>
                      {FUEL_SERVICE_OPTIONS.map(opt => (
                        <Chip key={opt.value} label={opt.label} active={fuelServiceType === opt.value}
                          onPress={() => setFuelServiceType(fuelServiceType === opt.value ? null : opt.value)} />
                      ))}
                    </View>
                  </>
                )}

                {/* Transportation */}
                <Text style={s.label}>TRANSPORTATION <Text style={s.optionalTag}>MULTI-SELECT</Text></Text>
                <View style={s.chipRow}>
                  {TRANSPORT_OPTIONS.map(opt => (
                    <Chip key={opt.value} label={opt.label} icon={opt.icon}
                      active={transportOptions.includes(opt.value)}
                      onPress={() => toggleTransport(opt.value)} />
                  ))}
                </View>

                {/* After-hours */}
                <Text style={s.label}>AFTER-HOURS ACCESS</Text>
                <View style={s.chipRow}>
                  {YES_NO_UNSURE.map(opt => (
                    <Chip key={opt.value} label={opt.label} active={afterHoursAccess === opt.value}
                      onPress={() => setAfterHoursAccess(afterHoursAccess === opt.value ? null : opt.value)} />
                  ))}
                </View>

                {/* Overnight */}
                <Text style={s.label}>OVERNIGHT FRIENDLY</Text>
                <View style={s.chipRow}>
                  {YES_NO_UNSURE.map(opt => (
                    <Chip key={opt.value} label={opt.label} active={overnightFriendly === opt.value}
                      onPress={() => setOvernightFriendly(overnightFriendly === opt.value ? null : opt.value)} />
                  ))}
                </View>

                {/* Food Access */}
                <Text style={s.label}>FOOD ACCESS</Text>
                <View style={s.chipRow}>
                  {FOOD_ACCESS_OPTIONS.map(opt => (
                    <Chip key={opt.value} label={opt.label} active={foodAccess === opt.value}
                      onPress={() => setFoodAccess(foodAccess === opt.value ? null : opt.value)} />
                  ))}
                </View>

                {/* Visit Reason */}
                <Text style={s.label}>VISIT REASON</Text>
                <View style={s.chipRow}>
                  {VISIT_REASONS.map(opt => (
                    <Chip key={opt.value} label={opt.label} icon={opt.icon} active={visitReason === opt.value}
                      onPress={() => setVisitReason(visitReason === opt.value ? null : opt.value)} />
                  ))}
                </View>
              </>
            )}

            {/* ════════ ACTIONS ════════ */}
            {saveError && (
              <View style={s.errorRow}>
                <Feather name="alert-circle" size={14} color="#F87171" />
                <Text style={s.errorText}>{saveError}</Text>
              </View>
            )}
            <TouchableOpacity style={[s.submitBtn, !hasContent() && s.submitBtnDisabled]}
              onPress={submit} disabled={saving || !hasContent()} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color="#0D1421" /> : <Text style={s.submitText}>{isEdit ? 'Update Report' : 'Submit Review'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.skipBtn} onPress={handleClose} activeOpacity={0.7}>
              <Text style={s.skipText}>{isEdit ? 'Cancel' : 'Skip for now'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Reusable chip component ─────────────────────────────────────────────────

function Chip({ label, icon, active, onPress }: { label: string; icon?: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[s.chip, active && s.chipActive]} onPress={onPress} activeOpacity={0.7}>
      {icon && <MaterialCommunityIcons name={icon as any} size={14} color={active ? '#EDF3FB' : '#6B83A0'} />}
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay:   { flex: 1, justifyContent: 'flex-end' },
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#0D1421', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderColor: '#1A2D45', borderBottomWidth: 0, maxHeight: '88%',
  },
  handle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: '#1E2D45', alignSelf: 'center', marginTop: 12 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 },

  headerRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4FF' },
  headerSub:   { fontSize: 13, color: '#6B83A0', marginBottom: 20 },

  label: { fontSize: 10, fontWeight: '800', color: '#6B83A0', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 8, marginTop: 4 },
  optionalTag: { color: '#4A5B73', fontWeight: '700', letterSpacing: 1.2 },

  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 9, paddingHorizontal: 12,
    backgroundColor: '#0A1220', borderRadius: 10, borderWidth: 1, borderColor: '#1E2D42',
  },
  chipActive:     { backgroundColor: 'rgba(56,189,248,0.12)', borderColor: 'rgba(56,189,248,0.40)' },
  chipText:       { fontSize: 12, fontWeight: '600', color: '#6B83A0' },
  chipTextActive: { color: '#EDF3FB', fontWeight: '700' },

  inlineInput: {
    backgroundColor: '#0A1220', borderRadius: 10, borderWidth: 1, borderColor: '#1E2D42',
    paddingHorizontal: 12, paddingVertical: 10, color: '#EDF3FB', fontSize: 14,
    marginTop: -6, marginBottom: 14,
  },
  starRow: { flexDirection: 'row', gap: 4, marginBottom: 14 },
  starBtn: { padding: 4 },

  fuelPriceRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  fuelPriceLabel: { fontSize: 13, color: '#6B83A0', fontWeight: '500' },
  fuelPriceInput: {
    flex: 1, backgroundColor: '#0A1220', borderRadius: 10, borderWidth: 1, borderColor: '#1E2D42',
    paddingHorizontal: 12, paddingVertical: 10, color: '#EDF3FB', fontSize: 15, fontWeight: '600',
  },

  notesInput: {
    backgroundColor: '#0A1220', borderRadius: 12, borderWidth: 1, borderColor: '#1E2D42',
    paddingHorizontal: 14, paddingVertical: 12, color: '#EDF3FB', fontSize: 14,
    minHeight: 60, marginBottom: 18,
  },

  moreToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 18,
    backgroundColor: 'rgba(56,189,248,0.06)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(56,189,248,0.15)',
  },
  moreToggleText: { fontSize: 14, fontWeight: '600', color: SKY },
  moreToggleHint: { fontSize: 11, color: '#4A5B73', marginLeft: 'auto' },
  moreDivider: {
    height: 1, backgroundColor: '#1A2535', marginBottom: 14,
  },

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 4 },
  errorText: { fontSize: 13, color: '#F87171', fontWeight: '500', flex: 1 },
  submitBtn: { backgroundColor: SKY, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  submitBtnDisabled: { opacity: 0.35 },
  submitText: { fontSize: 16, fontWeight: '800', color: '#0D1421' },
  skipBtn:    { alignItems: 'center', paddingVertical: 10 },
  skipText:   { fontSize: 14, color: '#6B83A0', fontWeight: '500' },

  successIcon:  { alignItems: 'center', marginBottom: 12, marginTop: 8 },
  successTitle: { fontSize: 20, fontWeight: '800', color: '#F0F4FF', textAlign: 'center', marginBottom: 6 },
  successSub:   { fontSize: 13, color: '#6B83A0', textAlign: 'center', marginBottom: 20 },
  summaryCard:  { backgroundColor: '#0A1628', borderRadius: 14, borderWidth: 1, borderColor: '#1E2D42', padding: 14, marginBottom: 20 },
  summaryRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  summaryRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1A2535' },
  summaryText:  { fontSize: 13, color: '#C8D8EE', fontWeight: '500', flex: 1 },
});

import { supabase } from '../supabaseClient';

const getShiftType = (time) => {
  const startTime = parseInt(time.split('-')[0]);
  if (startTime < 1200) return 'early';
  return 'late';
};

const getShiftDurationInHours = (time) => {
  const [start, end] = time.split('-').map(t => parseInt(t));
  const startMin = Math.floor(start / 100) * 60 + (start % 100);
  const endMin = Math.floor(end / 100) * 60 + (end % 100);
  let duration = (endMin - startMin) / 60;
  if (duration < 0) duration += 24;
  return duration;
};

const getShiftStartInMinutes = (time) => {
  const start = parseInt(time.split('-')[0]);
  return Math.floor(start / 100) * 60 + (start % 100);
};

const getShiftEndInMinutes = (time) => {
  const end = parseInt(time.split('-')[1]);
  return Math.floor(end / 100) * 60 + (end % 100);
};

const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Function to calculate the number of available days for a worker
const getAvailableDaysCount = (availabilityByDay) => {
  return daysOfWeek.reduce((count, day) => {
    const preference = availabilityByDay[day];
    return preference === 'any' || preference === 'early' || preference === 'late' ? count + 1 : count;
  }, 0);
};
// Function to check if worker is available on Saturday or Sunday
const hasWeekendAvailability = (availabilityByDay) => {
  const saturday = availabilityByDay.saturday;
  const sunday = availabilityByDay.sunday;
  return (
    (saturday === 'any' || saturday === 'early' || saturday === 'late') ||
    (sunday === 'any' || sunday === 'early' || sunday === 'late')
  );
};

const allocateWorkers = async () => {
  // 🔐 Get session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.user) {
    throw new Error("User not logged in");
  }

  const userId = session.user.id;

  // 🏢 Get organization_id from profile
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new Error("Could not fetch user profile or organization");
  }

  const organizationId = profile.organization_id;

  // 👷‍♂️ Fetch workers & stations
  const { data: workersData, error: workerError } = await supabase
    .from('workers')
    .select('*')
    .eq('organization_id', organizationId);

  const { data: stationsData, error: stationError } = await supabase
    .from('stations')
    .select('*')
    .eq('organization_id', organizationId);

  if (workerError || stationError) {
    console.error('Error fetching data:', workerError || stationError);
    return [];
  }

  // 📊 Setup tracking
  const workerAllocations = {};
  const workerShiftHistory = {};
  const workerTotalHours = {};

  // 🧠 Preprocess workers
  const workers = workersData.map(worker => ({
    ...worker,
    canworkstations: worker.canworkstations || [],
    role: worker.role || '',
    availabilityByDay: {
      monday: worker.monday?.toLowerCase() || null,
      tuesday: worker.tuesday?.toLowerCase() || null,
      wednesday: worker.wednesday?.toLowerCase() || null,
      thursday: worker.thursday?.toLowerCase() || null,
      friday: worker.friday?.toLowerCase() || null,
      saturday: worker.saturday?.toLowerCase() || null,
      sunday: worker.sunday?.toLowerCase() || null,
    },
  availableDaysCount: getAvailableDaysCount({
    monday: worker.monday?.toLowerCase() || null,
    tuesday: worker.tuesday?.toLowerCase() || null,
    wednesday: worker.wednesday?.toLowerCase() || null,
    thursday: worker.thursday?.toLowerCase() || null,
    friday: worker.friday?.toLowerCase() || null,
    saturday: worker.saturday?.toLowerCase() || null,
    sunday: worker.sunday?.toLowerCase() || null,
  }),
  hasWeekend: hasWeekendAvailability({
    monday: worker.monday?.toLowerCase() || null,
    tuesday: worker.tuesday?.toLowerCase() || null,
    wednesday: worker.wednesday?.toLowerCase() || null,
    thursday: worker.thursday?.toLowerCase() || null,
    friday: worker.friday?.toLowerCase() || null,
    saturday: worker.saturday?.toLowerCase() || null,
    sunday: worker.sunday?.toLowerCase() || null,
  }),
  }));

  // 🔄 Process each station
  return stationsData.map((station) => {
    const shiftType = getShiftType(station.time).toLowerCase();
    const shiftDurationHours = getShiftDurationInHours(station.time);
    const currentStartInMinutes = getShiftStartInMinutes(station.time);
    const day = station.day.toLowerCase();

    // 🎯 Filter eligible workers
    const eligibleWorkers = workers.filter((worker) => {
      const shiftPreference = worker.availabilityByDay[day];
      const isAvailable = shiftPreference === 'any' || shiftPreference === shiftType;

      const canWorkAtLocation = worker.canworkstations
        .map(loc => loc.toLowerCase())
        .includes(station.location.toLowerCase());

      const isNotAllocatedForDay = !workerAllocations[worker.id]?.includes(day);

      const todayIndex = daysOfWeek.indexOf(day);
      const prevDay = todayIndex > 0 ? daysOfWeek[todayIndex - 1] : null;

      let hasEnoughRest = true;
      if (prevDay && workerShiftHistory[worker.id]?.[prevDay]) {
        const prevEnd = getShiftEndInMinutes(workerShiftHistory[worker.id][prevDay].time);
        let diff = currentStartInMinutes - prevEnd;
        if (diff < 0) diff += 1440;
        hasEnoughRest = diff >= 720;
      }

      const currentHours = workerTotalHours[worker.id] || 0;
      const exceedsLimit = currentHours + shiftDurationHours > 72;
      const hasMatchingRole = worker.role.toLowerCase() === station.role.toLowerCase();

      // Check if worker has less than 5 shifts assigned
      const shiftCount = workerAllocations[worker.id]?.length || 0;
      const withinShiftLimit = shiftCount < 5;

      return isAvailable && canWorkAtLocation && isNotAllocatedForDay && hasEnoughRest && !exceedsLimit && hasMatchingRole && withinShiftLimit;
    });

    // 🔽 Sort by total hours worked so far
    eligibleWorkers.sort((a, b) => {
  const availableDaysA = a.availableDaysCount;
  const availableDaysB = b.availableDaysCount;
  if (availableDaysA !== availableDaysB) {
    return availableDaysB - availableDaysA; // Higher availability first
  }
  const hasWeekendA = a.hasWeekend;
  const hasWeekendB = b.hasWeekend;
  if (hasWeekendA !== hasWeekendB) {
    return hasWeekendB - hasWeekendA; // Prefer workers with weekend availability
  }
  const hoursA = workerTotalHours[a.id] || 0;
  const hoursB = workerTotalHours[b.id] || 0;
  return hoursA - hoursB; // Lower hours worked first if availability is equal
});

    const bestWorker = eligibleWorkers[0];

    if (bestWorker) {
      // Update tracking
      if (!workerAllocations[bestWorker.id]) workerAllocations[bestWorker.id] = [];
      if (!workerShiftHistory[bestWorker.id]) workerShiftHistory[bestWorker.id] = {};
      if (!workerTotalHours[bestWorker.id]) workerTotalHours[bestWorker.id] = 0;

      workerAllocations[bestWorker.id].push(day);
      workerShiftHistory[bestWorker.id][day] = { shiftType, time: station.time };
      workerTotalHours[bestWorker.id] += shiftDurationHours;

      return {
        ...station,
        allocatedTo: bestWorker.name,
      };
    } else {
      return {
        ...station,
        allocatedTo: 'Unassigned',
      };
    }
  });
};

export default allocateWorkers;
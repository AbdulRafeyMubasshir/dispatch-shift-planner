import { supabase } from '../supabaseClient';

const getShiftType = (time) => {
  const [start, end] = time.split('-').map(t => parseInt(t));
  const startMin = Math.floor(start / 100) * 60 + (start % 100);
  const endMin = Math.floor(end / 100) * 60 + (end % 100);
  const isOvernight = endMin <= startMin;
  if (isOvernight) return 'night';
  if (start >= 400 && start < 1200) return 'early';
  if (start >= 1200 && start < 2300) return 'late';
  return 'night';
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

// Mapping of worker availability to allowed shift types
const availabilityToShiftTypes = {
  'early': ['early'],
  'late': ['late'],
  'night': ['night'],
  'any': ['early', 'late', 'night'],
  'early/late': ['early', 'late'],
  'early/night': ['early', 'night'],
  'late/night': ['late', 'night'],
  'night/late': ['night', 'late'],
  '': [],
  'n/a': [],
  'al': [],
  'rest day': [],
  null: [],
};

// Function to calculate the number of available days for a worker
const getAvailableDaysCount = (availabilityByDay) => {
  return daysOfWeek.reduce((count, day) => {
    const preference = availabilityByDay[day];
    const allowedShifts = availabilityToShiftTypes[preference] || [];
    return allowedShifts.length > 0 ? count + 1 : count;
  }, 0);
};

// Function to check if worker is available on Saturday or Sunday
const hasWeekendAvailability = (availabilityByDay) => {
  const saturday = availabilityByDay.saturday;
  const sunday = availabilityByDay.sunday;
  const saturdayShifts = availabilityToShiftTypes[saturday] || [];
  const sundayShifts = availabilityToShiftTypes[sunday] || [];
  return saturdayShifts.length > 0 || sundayShifts.length > 0;
};

// List of workers restricted to London Kings Cross Station
const kingsCrossWorkers = ['Ali Husnain', 'Artur Pietrzela', 'Mark Smith', 'Ardeshir Abazi'];

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
    .select('*, hours') // Include hours column
    .eq('organization_id', organizationId);

  if (workerError || stationError) {
    console.error('Error fetching data:', workerError || stationError);
    return [];
  }

  // 📈 Sort stations by hours in descending order
  const sortedStationsData = [...stationsData].sort((a, b) => {
    const hoursA = Number(a.hours) || 0; // Convert to number, default to 0 if null/undefined
    const hoursB = Number(b.hours) || 0;
    return hoursB - hoursA; // Descending order
  });

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
  // First Pass: Process only Kings Cross stations with kingsCrossWorkers
  const firstPassResults = sortedStationsData.map((station) => {
    const isKingsCross = station.location.toLowerCase() === 'kings cross';
    if (!isKingsCross) {
      return { ...station, allocatedTo: 'Unassigned' };
    }

    const shiftType = getShiftType(station.time).toLowerCase();
    const shiftDurationHours = Number(station.hours) || getShiftDurationInHours(station.time); // Use hours column if available
    const currentStartInMinutes = getShiftStartInMinutes(station.time);
    const currentEndInMinutes = getShiftEndInMinutes(station.time);
    const day = station.day.toLowerCase();

    // 🎯 Filter eligible workers
    let eligibleWorkers = workers.filter((worker) => {
      const isRestrictedWorker = kingsCrossWorkers.includes(worker.name);
      if (!isRestrictedWorker) return false;

      const shiftPreference = worker.availabilityByDay[day];
      const allowedShifts = availabilityToShiftTypes[shiftPreference] || [];
      const isAvailable = allowedShifts.includes(shiftType);

      const canWorkAtLocation = worker.canworkstations
        .map(loc => loc.toLowerCase())
        .includes(station.location.toLowerCase());

      const isNotAllocatedForDay = !workerAllocations[worker.id]?.includes(day);

      const todayIndex = daysOfWeek.indexOf(day);
      const prevDay = todayIndex > 0 ? daysOfWeek[todayIndex - 1] : null;
      const nextDay = todayIndex < daysOfWeek.length - 1 ? daysOfWeek[todayIndex + 1] : null;

      let hasEnoughRest = true;
      if (prevDay && workerShiftHistory[worker.id]?.[prevDay]) {
        const prevTime = workerShiftHistory[worker.id][prevDay].time;
        const prevStart = getShiftStartInMinutes(prevTime);
        const prevEnd = getShiftEndInMinutes(prevTime);
        const isPrevOvernight = prevEnd <= prevStart;
        let restMinutes;
        if (!isPrevOvernight) {
          restMinutes = (1440 - prevEnd) + currentStartInMinutes;
        } else {
          restMinutes = currentStartInMinutes - prevEnd;
        }
        hasEnoughRest = restMinutes >= 720;
      }
      if (hasEnoughRest && nextDay && workerShiftHistory[worker.id]?.[nextDay]) {
        const nextTime = workerShiftHistory[worker.id][nextDay].time;
        const nextStart = getShiftStartInMinutes(nextTime);
        const isCurrentOvernight = currentEndInMinutes <= currentStartInMinutes;
        let restMinutes;
        if (!isCurrentOvernight) {
          restMinutes = (1440 - currentEndInMinutes) + nextStart;
        } else {
          restMinutes = nextStart - currentEndInMinutes;
        }
        hasEnoughRest = restMinutes >= 720;
      }

      const currentHours = workerTotalHours[worker.id] || 0;
      const exceedsLimit = currentHours + shiftDurationHours > 72;
      const hasMatchingRole = worker.role.toLowerCase() === station.role.toLowerCase();

      const shiftCount = workerAllocations[worker.id]?.length || 0;
      const withinShiftLimit = shiftCount < 5;

      return isAvailable && canWorkAtLocation && isNotAllocatedForDay && hasEnoughRest && !exceedsLimit && hasMatchingRole && withinShiftLimit;
    });

    // 🔽 Sort by total hours worked so far
    eligibleWorkers.sort((a, b) => {
      const availableDaysA = a.availableDaysCount;
      const availableDaysB = b.availableDaysCount;
      /*
      if (availableDaysA !== availableDaysB) {
        return availableDaysB - availableDaysA; // Higher availability first
      }
      const hasWeekendA = a.hasWeekend;
      const hasWeekendB = b.hasWeekend;
      if (hasWeekendA !== hasWeekendB) {
        return hasWeekendB - hasWeekendA; // Prefer workers with weekend availability
      }
      */
      const hoursA = workerTotalHours[a.id] || 0;
      const hoursB = workerTotalHours[b.id] || 0;
      return hoursA - hoursB; // Lower hours worked first
    });

    const bestWorker = eligibleWorkers[0];

    if (bestWorker) {
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

  // Second Pass: Process unassigned stations with all workers
  const finalResults = firstPassResults.map((station) => {
    if (station.allocatedTo !== 'Unassigned') {
      return station;
    }

    const shiftType = getShiftType(station.time).toLowerCase();
    const shiftDurationHours = Number(station.hours) || getShiftDurationInHours(station.time); // Use hours column if available
    const currentStartInMinutes = getShiftStartInMinutes(station.time);
    const currentEndInMinutes = getShiftEndInMinutes(station.time);
    const day = station.day.toLowerCase();

    // 🎯 Filter eligible workers
    let eligibleWorkers = workers.filter((worker) => {
      const shiftPreference = worker.availabilityByDay[day];
      const allowedShifts = availabilityToShiftTypes[shiftPreference] || [];
      const isAvailable = allowedShifts.includes(shiftType);

      const canWorkAtLocation = worker.canworkstations
        .map(loc => loc.toLowerCase())
        .includes(station.location.toLowerCase());

      const isNotAllocatedForDay = !workerAllocations[worker.id]?.includes(day);

      const todayIndex = daysOfWeek.indexOf(day);
      const prevDay = todayIndex > 0 ? daysOfWeek[todayIndex - 1] : null;
      const nextDay = todayIndex < daysOfWeek.length - 1 ? daysOfWeek[todayIndex + 1] : null;

      let hasEnoughRest = true;
      if (prevDay && workerShiftHistory[worker.id]?.[prevDay]) {
        const prevTime = workerShiftHistory[worker.id][prevDay].time;
        const prevStart = getShiftStartInMinutes(prevTime);
        const prevEnd = getShiftEndInMinutes(prevTime);
        const isPrevOvernight = prevEnd <= prevStart;
        let restMinutes;
        if (!isPrevOvernight) {
          restMinutes = (1440 - prevEnd) + currentStartInMinutes;
        } else {
          restMinutes = currentStartInMinutes - prevEnd;
        }
        hasEnoughRest = restMinutes >= 720;
      }
      if (hasEnoughRest && nextDay && workerShiftHistory[worker.id]?.[nextDay]) {
        const nextTime = workerShiftHistory[worker.id][nextDay].time;
        const nextStart = getShiftStartInMinutes(nextTime);
        const isCurrentOvernight = currentEndInMinutes <= currentStartInMinutes;
        let restMinutes;
        if (!isCurrentOvernight) {
          restMinutes = (1440 - currentEndInMinutes) + nextStart;
        } else {
          restMinutes = nextStart - currentEndInMinutes;
        }
        hasEnoughRest = restMinutes >= 720;
      }

      const currentHours = workerTotalHours[worker.id] || 0;
      const exceedsLimit = currentHours + shiftDurationHours > 72;
      const hasMatchingRole = worker.role.toLowerCase() === station.role.toLowerCase();

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
      return hoursA - hoursB; // Lower hours worked first
    });

    const bestWorker = eligibleWorkers[0];

    if (bestWorker) {
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

  return finalResults;
};

export default allocateWorkers;
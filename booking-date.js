/* Original date checker with no page navigation; reuse existing Supabase RPCs. */
(() => {


  /* ============================================================
     SUPABASE CONFIGURATION
     ============================================================ */

  const SUPABASE_URL =
    'https://untytznzbngourawgbqx.supabase.co';

  const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudHl0em56Ym5nb3VyYXdnYnF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzMjg0NzQsImV4cCI6MjEwMDkwNDQ3NH0.SMdbMdWeM2JWJE7C0FHTngceBUXnoEimwygAlPR0fhM';

  const DISTRICTS_TABLE =
    'postcode_districts';

  const DISTRICT_COLUMN =
    'district';

  const FEE_COLUMN =
    'fee';

  const BOOKINGS_TABLE =
    'bookings';

  const BOOKING_DATE_COLUMN =
    'event_date';

  const SUPABASE_CONFIGURED =
    !SUPABASE_URL.includes('YOUR-PROJECT-REF');


  /*
    Safety fallback only.

    The real date comes from:
    public.get_earliest_bookable_date()

    If Supabase temporarily cannot be reached, we fail safe and
    continue blocking dates before 1 March 2027 rather than
    accidentally opening them.
  */

  const FALLBACK_EARLIEST_BOOKABLE_DATE =
    '2027-03-01';


  /* ============================================================
     DEMO VALUES
     ============================================================ */

  const DEMO_DISTRICTS = {
    'PR1':  0,
    'M1':   25,
    'M2':   25,
    'L1':   35,
    'LS1':  45,
    'CH1':  30,
    'SW1A': 120
  };


  const DEMO_BLOCKED_DATES = (() => {

    const now =
      new Date();

    const fmt =
      (y, m, day) =>
        y +
        '-' +
        String(m + 1).padStart(2, '0') +
        '-' +
        String(day).padStart(2, '0');

    const todayMidnight =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );

    const candidates = [

      fmt(
        now.getFullYear(),
        now.getMonth(),
        10
      ),

      fmt(
        now.getFullYear(),
        now.getMonth(),
        20
      ),

      fmt(
        now.getFullYear(),
        now.getMonth() + 1,
        5
      ),

      fmt(
        now.getFullYear(),
        now.getMonth() + 1,
        15
      )

    ];

    return candidates.filter(
      dStr =>
        new Date(dStr + 'T00:00:00') >=
        todayMidnight
    );

  })();


  /* ============================================================
     POSTCODE
     ============================================================ */

  const POSTCODE_REGEX =
    /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;

  let travelFee =
    0;

  let feeReady =
    false;

  let postcodeValid =
    false;


  function extractDistrict(pc){

    const clean =
      (pc || '')
        .trim()
        .toUpperCase();

    const match =
      clean.match(
        POSTCODE_REGEX
      );

    return match
      ? match[1]
      : null;

  }


  async function lookupDistrictFee(district){

    if(!SUPABASE_CONFIGURED){

      return Object.prototype.hasOwnProperty.call(
        DEMO_DISTRICTS,
        district
      )
        ? DEMO_DISTRICTS[district]
        : null;

    }

    try{

      const url =
        `${SUPABASE_URL}/rest/v1/${DISTRICTS_TABLE}` +
        `?${DISTRICT_COLUMN}=eq.${encodeURIComponent(district)}` +
        `&select=${FEE_COLUMN}`;

      const res =
        await fetch(
          url,
          {
            headers:{
              apikey:
                SUPABASE_ANON_KEY,

              Authorization:
                `Bearer ${SUPABASE_ANON_KEY}`
            }
          }
        );

      const rows =
        await res.json();

      if(
        Array.isArray(rows) &&
        rows.length
      ){

        return rows[0][FEE_COLUMN];

      }

    }
    catch(error){

      console.warn(
        'Supabase district lookup failed',
        error
      );

    }

    return null;

  }


  function setPostcodeError(msg){

    const fieldEl =
      document.getElementById(
        'postcodeField'
      );

    const errEl =
      document.getElementById(
        'postcodeError'
      );

    fieldEl.classList.add(
      'has-error'
    );

    fieldEl.classList.remove(
      'is-valid'
    );

    errEl.textContent =
      msg;

    errEl.classList.add(
      'show'
    );

    document
      .getElementById(
        'mileageLine'
      )
      .classList
      .add(
        'empty'
      );

  }


  function clearPostcodeError(){

    const fieldEl =
      document.getElementById(
        'postcodeField'
      );

    document
      .getElementById(
        'postcodeError'
      )
      .classList
      .remove(
        'show'
      );

    fieldEl.classList.remove(
      'has-error'
    );

  }


  function updateSummary(){

    const resultEl =
      document.getElementById(
        'availResult'
      );

    const titleEl =
      document.getElementById(
        'availTitle'
      );

    const bodyEl =
      document.getElementById(
        'availBody'
      );

    const totalRow =
      document.getElementById(
        'checkTotal'
      );


    const validSelectedDate =
      selectedDate &&
      selectedDate >=
        earliestBookableDateString &&
      !blockedDates.has(
        selectedDate
      );


    if(
      postcodeValid &&
      validSelectedDate
    ){

      resultEl.classList.remove(
        'unavailable'
      );

      resultEl.classList.add(
        'available',
        'show'
      );

      titleEl.textContent =
        "You're all set";

      bodyEl.textContent =
        'That date is free at your venue. Continue to build your package, your venue, date and travel fee are already saved.';

      totalRow.style.display =
        'flex';

      document
        .getElementById(
          'checkMileageAmount'
        )
        .textContent =
          '£' + travelFee;

    }
    else{

      resultEl.classList.remove(
        'show',
        'available',
        'unavailable'
      );

      totalRow.style.display =
        'none';

    }

  }


  async function updateAreaFee(){

    const requestId = ++feeLookupSerial;
    const pc =
      document
        .getElementById(
          'cPostcode'
        )
        .value;

    const lineEl =
      document.getElementById(
        'mileageLine'
      );

    const fieldEl =
      document.getElementById(
        'postcodeField'
      );


    postcodeValid =
      false;

    feeReady =
      false;

    travelFee =
      0;

    fieldEl.classList.remove(
      'is-valid'
    );


    if(
      !pc.trim()
    ){

      clearPostcodeError();

      lineEl.classList.add(
        'empty'
      );

      updateSummary();

      return;

    }


    const district =
      extractDistrict(
        pc
      );


    if(
      !district
    ){

      setPostcodeError(
        "That doesn't look like a valid UK postcode. Double check and try again."
      );

      updateSummary();

      return;

    }


    lineEl.classList.remove(
      'empty'
    );

    lineEl.textContent =
      'Checking postcode…';


    const fee =
      await lookupDistrictFee(
        district
      );

    // Do not apply an older response after the postcode has been edited.
    if (requestId !== feeLookupSerial || document.getElementById('cPostcode').value !== pc) return;


    if(
      fee === null ||
      fee === undefined
    ){

      setPostcodeError(
        "We don't have coverage data for that postcode yet. Get in touch and we'll confirm your price manually."
      );

      updateSummary();

      return;

    }


    clearPostcodeError();

    fieldEl.classList.add(
      'is-valid'
    );

    postcodeValid =
      true;

    travelFee =
      Math.round(
        fee
      );

    feeReady =
      true;


    lineEl.textContent =
      travelFee > 0

        ? `Travel fee for this area: £${travelFee}`

        : 'Within our standard area, no extra travel fee';


    updateSummary();

  }


  let pcDebounce;
  let feeLookupSerial = 0;


  document
    .getElementById(
      'cPostcode'
    )
    .addEventListener(
      'input',
      () => {

        clearTimeout(
          pcDebounce
        );

        pcDebounce =
          setTimeout(
            updateAreaFee,
            600
          );

      }
    );


  /* ============================================================
     DATE HELPERS
     ============================================================ */

  function fmtDate(
    y,
    m,
    d
  ){

    return (
      y +
      '-' +
      String(m + 1)
        .padStart(2, '0') +
      '-' +
      String(d)
        .padStart(2, '0')
    );

  }


  function dateFromString(
    value
  ){

    if(
      !/^\d{4}-\d{2}-\d{2}$/.test(
        String(value || '')
      )
    ){

      return null;

    }


    const [
      year,
      month,
      day
    ] =
      value
        .split('-')
        .map(Number);


    const date =
      new Date(
        year,
        month - 1,
        day
      );


    date.setHours(
      0,
      0,
      0,
      0
    );


    if(
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ){

      return null;

    }


    return date;

  }


  function longDate(
    date
  ){

    return date
      .toLocaleDateString(
        'en-GB',
        {
          day:'numeric',
          month:'long',
          year:'numeric'
        }
      );

  }


  /* ============================================================
     EARLIEST BOOKABLE DATE
     ============================================================ */

  let earliestBookableDateString =
    FALLBACK_EARLIEST_BOOKABLE_DATE;

  let earliestBookableDate =
    dateFromString(
      FALLBACK_EARLIEST_BOOKABLE_DATE
    );


  async function fetchEarliestBookableDate(){

    if(
      !SUPABASE_CONFIGURED
    ){

      return FALLBACK_EARLIEST_BOOKABLE_DATE;

    }


    try{

      const res =
        await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/get_earliest_bookable_date`,
          {
            method:'POST',

            headers:{
              apikey:
                SUPABASE_ANON_KEY,

              Authorization:
                `Bearer ${SUPABASE_ANON_KEY}`,

              'Content-Type':
                'application/json'
            },

            body:
              '{}'
          }
        );


      if(
        !res.ok
      ){

        throw new Error(
          `Supabase returned ${res.status}`
        );

      }


      const result =
        await res.json();


      const value =
        typeof result === 'string'
          ? result
          : String(
              result || ''
            );


      if(
        !dateFromString(
          value
        )
      ){

        throw new Error(
          'Invalid earliest bookable date returned.'
        );

      }


      return value;

    }
    catch(error){

      console.warn(
        'Could not load earliest bookable date. Using safe fallback.',
        error
      );


      return FALLBACK_EARLIEST_BOOKABLE_DATE;

    }

  }


  /* ============================================================
     BLOCKED / BOOKED DATES
     ============================================================ */

  let blockedDates =
    new Set();
  let blockedDatesLoadFailed = false;


async function fetchBlockedDates(){

  if(!SUPABASE_CONFIGURED){
    return new Set(DEMO_BLOCKED_DATES);
  }

  try{

    // Ask the safe public RPC for blocked dates only.
    // No booking/customer information is exposed to the browser.
    const startDate =
      earliestBookableDateString;

    const endDate = (() => {
      const date = new Date(
        earliestBookableDate.getFullYear(),
        earliestBookableDate.getMonth() + 60,
        0
      );

      return fmtDate(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
    })();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_blocked_booking_dates`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_start_date: startDate,
          p_end_date: endDate
        })
      }
    );

    if(!res.ok){
      throw new Error(
        `Supabase returned ${res.status}`
      );
    }

    const rows = await res.json();

    if(!Array.isArray(rows)){
      throw new Error(
        'Invalid blocked-date response.'
      );
    }

    blockedDatesLoadFailed = false;
    return new Set(
      rows
        .map(row => row?.event_date)
        .filter(Boolean)
    );

  }
  catch(error){

    console.warn(
      'Could not load blocked dates.',
      error
    );

    blockedDatesLoadFailed = true;
    return new Set();

  }

}


  /* ============================================================
     CALENDAR
     ============================================================ */

  const todayDate =
    new Date();


  todayDate.setHours(
    0,
    0,
    0,
    0
  );


  let viewYear =
    todayDate.getFullYear();

  let viewMonth =
    todayDate.getMonth();

  let selectedDate =
    null;


  const MONTH_NAMES = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];


  function minimumCalendarDate(){

    if(
      earliestBookableDate >
      todayDate
    ){

      return earliestBookableDate;

    }

    return todayDate;

  }


  function minimumCalendarMonthIndex(){

    const date =
      minimumCalendarDate();


    return (
      date.getFullYear() * 12 +
      date.getMonth()
    );

  }


  function currentCalendarMonthIndex(){

    return (
      viewYear * 12 +
      viewMonth
    );

  }


  function renderCalendar(){

    document
      .getElementById(
        'calTitle'
      )
      .textContent =
        MONTH_NAMES[
          viewMonth
        ] +
        ' ' +
        viewYear;


    const firstOfMonth =
      new Date(
        viewYear,
        viewMonth,
        1
      );


    let startWeekday =
      firstOfMonth.getDay();


    startWeekday =
      startWeekday === 0
        ? 6
        : startWeekday - 1;


    const daysInMonth =
      new Date(
        viewYear,
        viewMonth + 1,
        0
      )
      .getDate();


    const grid =
      document.getElementById(
        'calGrid'
      );


    grid.innerHTML =
      '';


    for(
      let i = 0;
      i < startWeekday;
      i++
    ){

      const empty =
        document.createElement(
          'div'
        );

      empty.className =
        'cal-day cal-empty';

      grid.appendChild(
        empty
      );

    }


    for(
      let day = 1;
      day <= daysInMonth;
      day++
    ){

      const dateStr =
        fmtDate(
          viewYear,
          viewMonth,
          day
        );


      const cellDate =
        new Date(
          viewYear,
          viewMonth,
          day
        );


      cellDate.setHours(
        0,
        0,
        0,
        0
      );


      const cell =
        document.createElement(
          'button'
        );


      cell.type =
        'button';

      cell.className =
        'cal-day';

      cell.textContent =
        day;


      const isPast =
        cellDate <
        todayDate;


      const isBeforeOpening =
        dateStr <
        earliestBookableDateString;


      const isBlocked =
        blockedDates.has(
          dateStr
        );


      if(
        cellDate.getTime() ===
        todayDate.getTime()
      ){

        cell.classList.add(
          'cal-today'
        );

      }


      if(
        dateStr ===
        selectedDate
      ){

        cell.classList.add(
          'cal-selected'
        );

      }


      if(
        isPast
      ){

        cell.classList.add(
          'cal-disabled'
        );

        cell.disabled =
          true;

        cell.title =
          'This date has passed';

      }

      else if(
        isBeforeOpening
      ){

        cell.classList.add(
          'cal-not-open'
        );

        cell.disabled =
          true;

        cell.title =
          `Bookings open from ${longDate(earliestBookableDate)}`;

      }

      else if(
        isBlocked
      ){

        cell.classList.add(
          'cal-blocked'
        );

        cell.disabled =
          true;

        cell.title =
          'Already booked';

      }

      else{

        cell.addEventListener(
          'click',
          () => {

            selectedDate =
              dateStr;


            renderCalendar();


            const formatted =
              cellDate
                .toLocaleDateString(
                  'en-GB',
                  {
                    weekday:'long',
                    day:'numeric',
                    month:'long',
                    year:'numeric'
                  }
                );


            document
              .getElementById(
                'calSelected'
              )
              .textContent =
                'Selected: ' +
                formatted;


            updateSummary();

          }
        );

      }


      grid.appendChild(
        cell
      );

    }


    const prevBtn =
      document.getElementById(
        'calPrev'
      );


    prevBtn.disabled =
      currentCalendarMonthIndex() <=
      minimumCalendarMonthIndex();

  }


  document
    .getElementById(
      'calPrev'
    )
    .addEventListener(
      'click',
      () => {

        if(
          currentCalendarMonthIndex() <=
          minimumCalendarMonthIndex()
        ){

          return;

        }


        viewMonth--;


        if(
          viewMonth < 0
        ){

          viewMonth =
            11;

          viewYear--;

        }


        renderCalendar();

      }
    );


  document
    .getElementById(
      'calNext'
    )
    .addEventListener(
      'click',
      () => {

        viewMonth++;


        if(
          viewMonth > 11
        ){

          viewMonth =
            0;

          viewYear++;

        }


        renderCalendar();

      }
    );


  /* ============================================================
     RESTORE PREVIOUS DATE / VENUE
     ============================================================ */

  function restoreSavedBooking(){

    const saved =
      sessionStorage.getItem(
        'oggBooking'
      );


    if(
      !saved
    ){

      return;

    }


    try{

      const data =
        JSON.parse(
          saved
        );


      if(
        data.venueName
      ){

        document
          .getElementById(
            'cVenue'
          )
          .value =
            data.venueName;

      }


      if(
        data.venuePostcode
      ){

        document
          .getElementById(
            'cPostcode'
          )
          .value =
            data.venuePostcode;

      }


      const savedDate =
        String(
          data.weddingDate ||
          ''
        );


      const savedDateObject =
        dateFromString(
          savedDate
        );


      const savedDateStillValid =
        savedDateObject &&
        savedDateObject >= todayDate &&
        savedDate >= earliestBookableDateString &&
        !blockedDates.has(
          savedDate
        );


      if(
        savedDateStillValid
      ){

        selectedDate =
          savedDate;


        viewYear =
          savedDateObject
            .getFullYear();


        viewMonth =
          savedDateObject
            .getMonth();


        document
          .getElementById(
            'calSelected'
          )
          .textContent =
            'Selected: ' +
            savedDateObject
              .toLocaleDateString(
                'en-GB',
                {
                  weekday:'long',
                  day:'numeric',
                  month:'long',
                  year:'numeric'
                }
              );

      }


      if(
        data.venuePostcode
      ){

        updateAreaFee();

      }


      updateSummary();

    }
    catch(error){

      console.warn(
        'Could not restore previous booking details.',
        error
      );

    }

  }


  /* ============================================================
     INITIALISE CALENDAR
     ============================================================ */

  async function initCalendar(){

    earliestBookableDateString =
      await fetchEarliestBookableDate();


    earliestBookableDate =
      dateFromString(
        earliestBookableDateString
      ) ||
      dateFromString(
        FALLBACK_EARLIEST_BOOKABLE_DATE
      );


    const bookingOpenNote =
      document.getElementById(
        'bookingOpenNote'
      );


    if(
      earliestBookableDate >
      todayDate
    ){

      bookingOpenNote.innerHTML =
        '<strong>Bookings are currently open from ' +
        longDate(
          earliestBookableDate
        ) +
        '.</strong> Earlier wedding dates are not available to book.';

    }
    else{

      bookingOpenNote.style.display =
        'none';

    }


    const firstVisibleDate =
      minimumCalendarDate();


    viewYear =
      firstVisibleDate
        .getFullYear();


    viewMonth =
      firstVisibleDate
        .getMonth();


    blockedDates =
      await fetchBlockedDates();


    restoreSavedBooking();


    renderCalendar();

  }


  initCalendar().then(async () => {
    // Revalidate saved context before opening the package step.
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('oggBooking') || 'null'); } catch {}
    if (!saved || !selectedDate || selectedDate !== saved.weddingDate ||
        !saved.venueName || !saved.venuePostcode) return;
    await updateAreaFee();
    if (!postcodeValid || !feeReady || blockedDatesLoadFailed ||
        blockedDates.has(selectedDate)) return;
    window.OTGGDateVerified?.({
      weddingDate: selectedDate, venueName: saved.venueName,
      venuePostcode: saved.venuePostcode,
      postcodeDistrict: extractDistrict(saved.venuePostcode), travelFee
    }, true);
  }).catch(error => console.warn('Date checker could not restore a saved selection', error));


  /* ============================================================
     SELECTED PRODUCT / PACKAGE FROM THE PAGE THE CUSTOMER USED
     ============================================================ */

  document
    .getElementById(
      'checkBtn'
    )
    .addEventListener(
      'click',
      async function(event){

        event.preventDefault();


        const venue =
          document
            .getElementById(
              'cVenue'
            )
            .value
            .trim();


        const postcode =
          document
            .getElementById(
              'cPostcode'
            )
            .value
            .trim();


        const date =
          selectedDate;


        const errorEl =
          document.getElementById(
            'formError'
          );


        const btn =
          this;


        if(
          !venue ||
          !postcode ||
          !date
        ){

          errorEl.textContent =
            'Please fill in venue name, postcode, and pick an available wedding date.';

          errorEl.style.display =
            'block';

          return;

        }


        if(
          date <
          earliestBookableDateString
        ){

          errorEl.textContent =
            `Bookings are currently only available from ${longDate(earliestBookableDate)}.`;

          errorEl.style.display =
            'block';

          return;

        }


        blockedDates = await fetchBlockedDates();
        if (blockedDatesLoadFailed) {
          errorEl.textContent = 'We cannot check availability right now. Please try again.';
          errorEl.style.display = 'block';
          return;
        }
        if(
          blockedDates.has(
            date
          )
        ){

          errorEl.textContent =
            'That date is no longer available. Please choose another date.';

          errorEl.style.display =
            'block';

          selectedDate =
            null;

          renderCalendar();

          return;

        }


        errorEl.style.display =
          'none';


        clearTimeout(pcDebounce);
        if(
          !feeReady
        ){

          btn.classList.add(
            'loading'
          );


          btn.textContent =
            'Checking…';


          await updateAreaFee();


          btn.classList.remove(
            'loading'
          );


          btn.textContent =
            'Check availability & continue ↓';

        }


        if(
          !postcodeValid
        ){

          document
            .getElementById(
              'postcodeField'
            )
            .scrollIntoView(
              {
                behavior:'smooth',
                block:'center'
              }
            );

          return;

        }


        /*
          Store the validated date, venue and travel fee for the booking page.
        */

        sessionStorage.setItem(
          'oggBooking',
          JSON.stringify(
            {
              venueName:
                venue,

              venuePostcode:
                postcode,

              postcodeDistrict:
                extractDistrict(
                  postcode
                ),

              weddingDate:
                date,

              travelFee:
                travelFee
            }
          )
        );


        window.OTGGDateVerified?.({
          weddingDate: date, venueName: venue, venuePostcode: postcode,
          postcodeDistrict: extractDistrict(postcode), travelFee
        }, false);

      }
    );


  ['cVenue', 'cPostcode'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      if (id === 'cPostcode') {
        postcodeValid = false;
        feeReady = false;
        travelFee = 0;
        ++feeLookupSerial;
      }
      window.OTGGDateDirty?.();
    });
  });
  document.getElementById('calGrid').addEventListener('click', event => {
    const day = event.target.closest('button.cal-day');
    if (day && !day.disabled) window.OTGGDateDirty?.();
  });

})();

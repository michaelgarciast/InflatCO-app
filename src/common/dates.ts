// en-CA formatea como YYYY-MM-DD.
const bogotaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
});

export const todayInBogota = () => bogotaDate.format(new Date());
